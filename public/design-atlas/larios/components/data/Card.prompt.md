**Card, Tabs** — surface + navigation.

**Card** — a matte panel; depth is the 1px hairline, not a shadow. Optional small-caps header with a right slot.

```jsx
<Card title="Walk-in" right={<Pill tone="ok" dot>On</Pill>}>
  …body…
</Card>
<Card title="Counts" padded={false}><DataTable … /></Card>
```

Set `floating` only for menus/modals (adds elevation).

**Tabs** — mono uppercase strip on a hairline; active tab gets an amber underline.

```jsx
<Tabs
  tabs={[{value:'line',label:'Line'},{value:'prep',label:'Prep'}]}
  defaultValue="line"
  onChange={(v) => setView(v)}
/>
```
