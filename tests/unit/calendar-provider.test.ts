import { describe, expect, it, vi } from 'vitest';
import { GoogleCalendarClient } from '@/features/calendar/google';
import {
  googleBody,
  mergeProvider,
  providerData,
  providerEventSchema,
  providerRetry,
  sharedEvent,
} from '@/features/calendar/provider-schema';
const raw = providerEventSchema.parse({
  id: 'remote',
  etag: '"a"',
  summary: 'Event',
  start: { dateTime: '2026-10-20T09:00:00+02:00', timeZone: 'Europe/Rome' },
  end: { dateTime: '2026-10-20T10:00:00+02:00' },
  hangoutLink: 'https://meet.google.com/abc',
  reminders: {
    useDefault: false,
    overrides: [
      { method: 'popup', minutes: 10 },
      { method: 'email', minutes: 20 },
    ],
  },
});
const local = providerData(raw, 'Europe/Rome')!;
const base = sharedEvent(local);
describe('provider projection and three-way reconciliation', () => {
  it('normalizes instants, preserves all-day exclusive dates and imports popup metadata', () => {
    expect(local.schedule).toMatchObject({
      start: '2026-10-20T07:00:00Z',
      end: '2026-10-20T08:00:00Z',
    });
    expect(local.reminders).toEqual([10]);
    const allDay = providerData(
      {
        ...raw,
        start: { date: '2026-10-20' },
        end: { date: '2026-10-21' },
        summary: undefined,
        reminders: { useDefault: true },
      },
      'Europe/Rome',
    )!;
    expect(allDay.schedule).toMatchObject({ start: '2026-10-20', end: '2026-10-21', allDay: true });
    expect(googleBody(allDay).end).toEqual({ date: '2026-10-21' });
    expect(googleBody(local).start).toEqual({
      dateTime: '2026-10-20T07:00:00Z',
      timeZone: 'Europe/Rome',
    });
    expect(googleBody(local)).not.toHaveProperty('attendees');
    expect(googleBody(local)).not.toHaveProperty('reminders');
  });
  it('does not silently truncate or flatten unsupported Google events', () => {
    for (const patch of [
      { status: 'cancelled' as const },
      { recurrence: ['RRULE:FREQ=WEEKLY'] },
      { recurringEventId: 'master' },
      { eventType: 'outOfOffice' },
      { summary: 'a'.repeat(241) },
      { start: undefined },
      { end: { dateTime: '2026-10-20T06:00:00Z' } },
    ])
      expect(providerData({ ...raw, ...patch }, 'Europe/Rome')).toBeNull();
  });
  it('merges disjoint fields and leaves incompatible fields explicit', () => {
    const mine = { ...base, title: 'Local' },
      theirs = { ...base, notes: 'Remote' };
    expect(mergeProvider(base, mine, theirs)).toEqual({
      data: { ...mine, notes: 'Remote' },
      conflicts: [],
    });
    expect(mergeProvider(base, mine, { ...base, title: 'Remote' }).conflicts).toEqual(['title']);
    const schedule = { ...base.schedule, end: '2026-10-20T09:00:00Z' };
    expect(
      mergeProvider(
        base,
        { ...base, schedule },
        { ...base, schedule: { ...schedule, start: '2026-10-20T08:00:00Z' } },
      ).conflicts,
    ).toEqual(['schedule']);
  });
  it('handles both directions, duplicates and delete-versus-edit conflicts', () => {
    const changed = { ...base, title: 'Changed' };
    expect(mergeProvider(base, base, changed)).toEqual({ data: changed, conflicts: [] });
    expect(mergeProvider(base, changed, base)).toEqual({ data: changed, conflicts: [] });
    expect(mergeProvider(base, changed, changed).conflicts).toEqual([]);
    expect(mergeProvider(null, base, base).conflicts).toEqual([]);
    expect(mergeProvider(base, null, base).data).toBeNull();
    expect(mergeProvider(base, base, null).data).toBeNull();
    expect(mergeProvider(base, changed, null).conflicts).toEqual(['deletedAt']);
    expect(mergeProvider(base, null, changed).conflicts).toEqual(['deletedAt']);
    expect(mergeProvider(null, base, changed).conflicts).toEqual(['deletedAt']);
    expect(providerRetry(0, 0)).toBe(22500);
    expect(providerRetry(100, 1)).toBe(4500000);
  });
});
describe('Google event transport', () => {
  const config = {
    clientId: 'test',
    clientSecret: 'test',
    redirectUri: 'https://test.invalid/callback',
    sub: 'test',
    email: 'test@example.test',
  };
  it('retains the same sync token across pages and requires a final cursor', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ items: [raw], nextPageToken: 'next' }))
      .mockResolvedValueOnce(Response.json({ items: [], nextSyncToken: 'new' }));
    expect(
      await new GoogleCalendarClient(config, request).events('access', 'test/@calendar', 'old'),
    ).toEqual({ events: [raw], syncToken: 'new' });
    const first = new URL(String(request.mock.calls[0][0])),
      second = new URL(String(request.mock.calls[1][0]));
    expect(first.pathname).toContain('test%2F%40calendar');
    expect(second.searchParams.get('syncToken')).toBe('old');
    expect(second.searchParams.get('pageToken')).toBe('next');
    expect(second.searchParams.get('singleEvents')).toBe('false');
    await expect(
      new GoogleCalendarClient(
        config,
        vi.fn<typeof fetch>().mockResolvedValue(Response.json({ items: [] })),
      ).events('a', 'c'),
    ).rejects.toMatchObject({ code: 'provider' });
  });
  it.each([
    [410, 'gone'],
    [404, 'not_found'],
    [412, 'precondition'],
    [409, 'exists'],
  ])('classifies %s for durable recovery', async (status, code) => {
    await expect(
      new GoogleCalendarClient(
        config,
        vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: Number(status) })),
      ).events('a', 'c'),
    ).rejects.toMatchObject({ code });
  });
  it('uses deterministic IDs, If-Match patches and conditional deletes', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(raw))
      .mockResolvedValueOnce(Response.json(raw))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json(raw));
    const client = new GoogleCalendarClient(config, request);
    await client.writeEvent('a', 'c', 'lifeosid', googleBody(local));
    await client.writeEvent('a', 'c', 'lifeosid', googleBody(local), '"old"');
    await client.deleteEvent('a', 'c', 'lifeosid', '"new"');
    await client.event('a', 'c', 'lifeosid');
    expect(JSON.parse(String(request.mock.calls[0][1]?.body)).id).toBe('lifeosid');
    expect(request.mock.calls[1][1]).toMatchObject({
      method: 'PATCH',
      headers: { 'If-Match': '"old"' },
    });
    expect(request.mock.calls[2][1]).toMatchObject({
      method: 'DELETE',
      headers: { 'If-Match': '"new"' },
    });
    expect(String(request.mock.calls[2][0])).toContain('sendUpdates=none');
  });
  it('creates expiring webhook channels and stops the exact provider resource', async () => {
    const expiration = Date.now() + 86400000;
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ id: 'channel', resourceId: 'resource', expiration: String(expiration) }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new GoogleCalendarClient(config, request);
    expect(
      await client.watch('access', 'test/@calendar', {
        id: 'channel',
        token: 'secret',
        address: 'https://example.test/notify',
        expiration,
      }),
    ).toEqual({ id: 'channel', resourceId: 'resource', expiration });
    expect(String(request.mock.calls[0][0])).toContain('test%2F%40calendar/events/watch');
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toMatchObject({
      type: 'web_hook',
      token: 'secret',
      expiration,
    });
    await client.stopWatch('access', 'channel', 'resource');
    expect(String(request.mock.calls[1][0])).toBe(
      'https://www.googleapis.com/calendar/v3/channels/stop',
    );
    expect(JSON.parse(String(request.mock.calls[1][1]?.body))).toEqual({
      id: 'channel',
      resourceId: 'resource',
    });
  });
});
