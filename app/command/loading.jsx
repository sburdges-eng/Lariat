// Command center loads server-side and blocks on the slowest tile query
// (costing benchmarks are CPU-heavy). Show shimmer tiles immediately so a
// manager on slow kitchen WiFi isn't staring at a blank screen.
export default function CommandCenterLoading() {
  return (
    <div className="fs-hub" aria-busy="true" aria-label="Loading command center">
      <h1>Command center</h1>
      <p className="subtitle">Where the kitchen stands right now.</p>

      <div className="fs-tiles">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="fs-tile" aria-hidden="true">
            <div className="fs-tile-head">
              <span className="skeleton" style={{ width: '40%', height: 16, borderRadius: 4 }} />
            </div>
            <span className="skeleton" style={{ width: '70%', height: 12, borderRadius: 4, marginTop: 8 }} />
            <span className="skeleton" style={{ width: '55%', height: 12, borderRadius: 4, marginTop: 6 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
