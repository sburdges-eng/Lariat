import AllergenLookupClient from './AllergenLookupClient.jsx';

export const metadata = {
  title: 'Allergen lookup — Lariat Cockpit',
};

export default function AllergenLookupPage() {
  return (
    <div>
      <h1>Allergen lookup</h1>
      <p className="subtitle">
        Quick "does this product contain X?" check across the Open Food Facts
        catalog. Type a product name, brand, or scan a GTIN barcode.
      </p>
      <AllergenLookupClient />
    </div>
  );
}
