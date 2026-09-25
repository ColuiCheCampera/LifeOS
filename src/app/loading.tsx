export default function Loading() {
  return (
    <div className="page" role="status" aria-label="Caricamento">
      <div className="skeleton heading-skeleton" />
      <div className="skeleton card-skeleton" />
    </div>
  );
}
