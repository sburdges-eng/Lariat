import AllergenLookupClient from './AllergenLookupClient.jsx';
import RecipeAttestations from './RecipeAttestations.jsx';

export const metadata = {
  title: 'Allergen lookup — Lariat Cockpit',
};

export default function AllergenLookupPage() {
  return (
    <div>
      <h1>Allergen lookup</h1>
      <p className="subtitle">
        Quick check for whether a product contains an allergen, across the Open
        Food Facts catalog. Type a product name, brand, or scan a barcode.
      </p>
      <AllergenLookupClient />
      <RecipeAttestations />
    </div>
  );
}
