'use client';
import React from 'react';
import StatusPill from '../StatusPill';
import { formatDollars } from '../../../lib/formatMoney';

export default function TicketsTab({ show }) {
  const s = show?.status ?? {};
  const price = formatDollars(show?.price);
  return (
    <div className="card" style={{ padding: 14 }}>
      <table className="tbl">
        <tbody>
          <tr>
            <td>Advance ticket price</td>
            <td className="mono">{price}</td>
          </tr>
          <tr>
            <td>Door price (door tix)</td>
            <td><StatusPill value={show?.door_tix} column="door_tix" /></td>
          </tr>
          <tr>
            <td>DICE tickets created</td>
            <td><StatusPill value={s.create_dice_tickets} column="create_dice_tickets" /></td>
          </tr>
          <tr>
            <td>Co-host sent</td>
            <td><StatusPill value={s.co_host_sent} column="co_host_sent" /></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
