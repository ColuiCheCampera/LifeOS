import { http, HttpResponse } from 'msw';
import { providerEventSchema, type ProviderEvent } from '../src/features/calendar/provider-schema';
const items = new Map<string, { event: ProviderEvent; revision: number }>();
let revision = 0;
const watches: {
  id: string;
  token: string;
  address: string;
  expiration: number;
  resourceId: string;
  earlyStatus?: number;
}[] = [];
const stopped: string[] = [];
export const calendarRemote = {
  role: 'owner',
  expire: false,
  failWriteAfter: false,
  raceWrite: false,
  pageSize: 2500,
  quota: false,
  watchFail: false,
  notifyDuringPull: false,
};
export function setRemoteEvent(value: Record<string, unknown>) {
  const old = items.get(String(value.id))?.event;
  const event = providerEventSchema.parse({
    status: 'confirmed',
    ...old,
    ...value,
    etag: `"revision-${++revision}"`,
    updated: new Date().toISOString(),
  });
  items.set(event.id, { event, revision });
  return event;
}
export function controlRemote(action: string, event?: Record<string, unknown>) {
  if (action === 'reset') {
    items.clear();
    revision = 0;
    watches.length = 0;
    stopped.length = 0;
    Object.assign(calendarRemote, {
      role: 'owner',
      expire: false,
      failWriteAfter: false,
      raceWrite: false,
      pageSize: 2500,
      quota: false,
      watchFail: false,
      notifyDuringPull: false,
    });
  }
  if (action === 'set' && event) setRemoteEvent(event);
  if (action === 'remove' && event) items.delete(String(event.id));
  if (action === 'fault' && event) Object.assign(calendarRemote, event);
  return { events: [...items.values()].map((i) => i.event), watches, stopped };
}
const collection = 'https://www.googleapis.com/calendar/v3/calendars/:calendarId/events';
export const calendarRemoteHandlers = [
  http.post(collection + '/watch', async ({ request }) => {
    if (calendarRemote.watchFail) return HttpResponse.json({ error: 'quota' }, { status: 429 });
    const body = (await request.json()) as (typeof watches)[number];
    const watch = { ...body, resourceId: 'resource-' + body.id };
    watches.push(watch);
    const early = await fetch('http://localhost:3100/api/calendar/google/notifications', {
      method: 'POST',
      headers: {
        'x-goog-channel-id': watch.id,
        'x-goog-channel-token': watch.token,
        'x-goog-resource-id': watch.resourceId,
        'x-goog-resource-state': 'sync',
        'x-goog-message-number': '1',
      },
    });
    watch.earlyStatus = early.status;
    return HttpResponse.json({
      id: watch.id,
      resourceId: watch.resourceId,
      expiration: String(watch.expiration),
    });
  }),
  http.post('https://www.googleapis.com/calendar/v3/channels/stop', async ({ request }) => {
    const body = (await request.json()) as { id: string };
    stopped.push(body.id);
    return new HttpResponse(null, { status: 204 });
  }),
  http.get(collection, async ({ request }) => {
    if (calendarRemote.notifyDuringPull && watches.length) {
      calendarRemote.notifyDuringPull = false;
      const watch = watches.at(-1)!;
      await fetch('http://localhost:3100/api/calendar/google/notifications', {
        method: 'POST',
        headers: {
          'x-goog-channel-id': watch.id,
          'x-goog-channel-token': watch.token,
          'x-goog-resource-id': watch.resourceId,
          'x-goog-resource-state': 'exists',
          'x-goog-message-number': '99999999999999999999',
        },
      });
    }
    if (calendarRemote.quota) return HttpResponse.json({ error: 'quota' }, { status: 429 });
    const url = new URL(request.url);
    if (calendarRemote.expire && url.searchParams.has('syncToken')) {
      calendarRemote.expire = false;
      return HttpResponse.json({ error: 'gone' }, { status: 410 });
    }
    const since = Number(url.searchParams.get('syncToken')?.replace('sync-', '') ?? -1);
    const candidates = [...items.values()]
      .filter((item) => item.revision > since)
      .map((item) => item.event);
    const offset = Number(url.searchParams.get('pageToken') ?? 0);
    const batch = candidates.slice(offset, offset + calendarRemote.pageSize);
    return HttpResponse.json({
      items: batch,
      ...(offset + batch.length < candidates.length
        ? { nextPageToken: String(offset + batch.length) }
        : { nextSyncToken: `sync-${revision}` }),
    });
  }),
  http.get(collection + '/:eventId', ({ params }) => {
    const item = items.get(String(params.eventId));
    return item
      ? HttpResponse.json(item.event)
      : HttpResponse.json({ error: 'missing' }, { status: 404 });
  }),
  http.post(collection, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    if (items.has(String(body.id))) return HttpResponse.json({ error: 'exists' }, { status: 409 });
    const event = setRemoteEvent(body);
    if (calendarRemote.failWriteAfter) {
      calendarRemote.failWriteAfter = false;
      return HttpResponse.json({ error: 'lost_response' }, { status: 500 });
    }
    return HttpResponse.json(event);
  }),
  http.patch(collection + '/:eventId', async ({ request, params }) => {
    const id = String(params.eventId);
    let item = items.get(id);
    if (!item) return HttpResponse.json({ error: 'missing' }, { status: 404 });
    if (calendarRemote.raceWrite) {
      calendarRemote.raceWrite = false;
      setRemoteEvent({ id, summary: 'Google concurrent change' });
      item = items.get(id)!;
    }
    if (request.headers.get('if-match') !== item.event.etag)
      return HttpResponse.json({ error: 'changed' }, { status: 412 });
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json(setRemoteEvent({ ...body, id }));
  }),
  http.delete(collection + '/:eventId', ({ request, params }) => {
    const id = String(params.eventId);
    const item = items.get(id);
    if (!item) return HttpResponse.json({ error: 'missing' }, { status: 404 });
    if (request.headers.get('if-match') !== item.event.etag)
      return HttpResponse.json({ error: 'changed' }, { status: 412 });
    setRemoteEvent({ id, status: 'cancelled' });
    return new HttpResponse(null, { status: 204 });
  }),
];
