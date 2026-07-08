**DataTable** — a dense grid: sticky mono header, faint zebra rows, right-aligned tabular numerics. Always right-align numeric columns; they auto-render in JetBrains Mono.

```jsx
<DataTable
  columns={[
    { key: 'item', label: 'Item' },
    { key: 'par', label: 'Par', align: 'right' },
    { key: 'onHand', label: 'On hand', align: 'right' },
  ]}
  rows={[
    { id: 1, item: 'Ribeye 12oz', par: 40, onHand: 12 },
    { id: 2, item: 'House brine', par: 6, onHand: 6 },
  ]}
/>
```

Pass ReactNodes as cell values (e.g. a `<Pill>` for status). Set `zebra={false}` for a flat grid.
