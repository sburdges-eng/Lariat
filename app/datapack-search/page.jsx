import DatapackSearchClient from './DatapackSearchClient.jsx';

export const metadata = {
  title: 'Data pack — Lariat Cockpit',
};

export default function DatapackSearchPage() {
  return (
    <div>
      <h1>Data pack</h1>
      <p className="subtitle">
        Look up ingredients and food-safety rules — USDA, Open Food Facts, Wikibooks Cookbook, FDA Food Code.
      </p>
      <DatapackSearchClient />
    </div>
  );
}
