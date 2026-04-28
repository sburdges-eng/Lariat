import DatapackSearchClient from './DatapackSearchClient.jsx';

export const metadata = {
  title: 'Data pack search — Lariat Cockpit',
};

export default function DatapackSearchPage() {
  return (
    <div>
      <h1>Data pack search</h1>
      <p className="subtitle">
        Lookup across USDA / Open Food Facts / Wikibooks Cookbook / FDA Food Code.
      </p>
      <DatapackSearchClient />
    </div>
  );
}
