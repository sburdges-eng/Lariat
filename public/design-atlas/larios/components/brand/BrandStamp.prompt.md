**BrandStamp** — the Lariat rope-loop signature mark, drawn in `currentColor` and sized in `em`. Use it inline beside the wordmark (decorative) or standalone as a section "wax seal".

```jsx
<span style={{ color: 'var(--accent)', fontSize: 28 }}>
  <BrandStamp decorative />
</span>
```

- `decorative` — aria-hidden when it sits next to visible text (the wordmark).
- Standalone: omit `decorative` and pass `label` for an accessible name.
- Inherits color from the parent — amber when active, bone otherwise.
