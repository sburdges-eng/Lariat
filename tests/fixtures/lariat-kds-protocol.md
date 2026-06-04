# Lariat-KDS protocol fixture

Source: `Lariat-KDS/docs/lariat-kds-protocol.md` at merge commit `84adff3`.

This fixture keeps Lariat CI deterministic when the sibling private repository
is not available to `GITHUB_TOKEN`. Local runs still prefer an actual
`Lariat-KDS` checkout or `LARIAT_KDS_PROTOCOL_DOC`.

### Response schema (200)

```json
{
  "id": "tkt_abc",
  "bumped_at": "2026-05-04T18:42:11Z"
}
```

### Status codes
