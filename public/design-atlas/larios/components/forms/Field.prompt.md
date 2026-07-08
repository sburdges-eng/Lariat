**Forms** — inset controls with a recessed app-bg fill and a hairline that lights amber on focus. `Field` stacks a mono uppercase label over any control.

```jsx
<Field label="Item" hint="What ran out">
  <Input placeholder="e.g. Ribeye 12oz" />
</Field>

<Field label="Station">
  <Select><option>Sauté</option><option>Grill</option></Select>
</Field>

<Field label="Note"><Textarea rows={3} /></Field>
```

- `invalid` puts an oxblood border on Input / Select / Textarea.
- Sizes `md` (default) / `lg` for line/iPad use.
