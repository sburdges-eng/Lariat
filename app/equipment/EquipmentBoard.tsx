'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { Equipment, EquipmentPart, EquipmentMaintenanceSchedule } from '../../lib/db';

export interface EquipmentBoardProps {
  equipment: (Equipment & { maintenance_cost: number })[];
  parts: EquipmentPart[];
  schedule: EquipmentMaintenanceSchedule[];
  locationId: string;
}

type DetailTab = 'details' | 'parts' | 'schedule' | 'log';

const USD = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function isWarrantyExpired(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
}

function isOverdue(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
}

export default function EquipmentBoard({ equipment, parts, schedule, locationId }: EquipmentBoardProps) {
  const router = useRouter();
  const [cookId, setCookId] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  const [showAdd, setShowAdd] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>('details');
  const [addPartFor, setAddPartFor] = useState<number | null>(null);
  const [addSchedFor, setAddSchedFor] = useState<number | null>(null);

  // Add equipment form
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Ovens');
  const [makeModel, setMakeModel] = useState('');
  const [modelNumber, setModelNumber] = useState('');
  const [serial, setSerial] = useState('');
  const [cost, setCost] = useState('');
  const [purchaseDate, setPurchaseDate] = useState('');
  const [warranty, setWarranty] = useState('');
  const [vendor, setVendor] = useState('');
  const [orderRef, setOrderRef] = useState('');
  const [manualPath, setManualPath] = useState('');
  const [notes, setNotes] = useState('');

  // Log maintenance
  const [mType, setMType] = useState('Repair');
  const [mCost, setMCost] = useState('');
  const [mNotes, setMNotes] = useState('');
  const [mReceipt, setMReceipt] = useState('');

  // Add part form
  const [pPartNum, setPPartNum] = useState('');
  const [pDesc, setPDesc] = useState('');
  const [pVendor, setPVendor] = useState('');
  const [pUnitPrice, setPUnitPrice] = useState('');
  const [pQty, setPQty] = useState('');
  const [pOrdered, setPOrdered] = useState('');
  const [pOrderRef, setPOrderRef] = useState('');
  const [pNotes, setPNotes] = useState('');

  // Add schedule form
  const [sTask, setSTask] = useState('');
  const [sFreq, setSFreq] = useState('Monthly');
  const [sLastDone, setSLastDone] = useState('');
  const [sNextDue, setSNextDue] = useState('');
  const [sNotes, setSNotes] = useState('');

  useEffect(() => { setCookId(window.localStorage.getItem('lariat_cook') || ''); }, []);

  const localDate = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const resetAddForm = () => {
    setName(''); setMakeModel(''); setModelNumber(''); setSerial(''); setCost('');
    setPurchaseDate(''); setWarranty(''); setVendor(''); setOrderRef('');
    setManualPath(''); setNotes('');
  };

  const postJSON = async (url: string, body: unknown): Promise<boolean> => {
    setSaving(true); setErr('');
    let ok = false;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      ok = res.ok;
      if (!ok) setErr('Didn\u2019t save \u2014 try again');
    } catch {
      setErr('Lost connection \u2014 not saved');
    }
    setSaving(false);
    return ok;
  };

  const handleAddEquipment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const ok = await postJSON('/api/equipment', {
      name: name.trim(), category,
      make_model: makeModel.trim() || null,
      model_number: modelNumber.trim() || null,
      serial_number: serial.trim() || null,
      purchase_cost: cost,
      purchase_date: purchaseDate || null,
      warranty_expiration: warranty || null,
      vendor: vendor.trim() || null,
      vendor_order_ref: orderRef.trim() || null,
      manual_path: manualPath.trim() || null,
      notes: notes.trim() || null,
      location_id: locationId,
    });
    if (!ok) return;
    resetAddForm();
    setShowAdd(false);
    router.refresh();
  };

  const handleAddMaintenance = async (e: React.FormEvent, equipId: number) => {
    e.preventDefault();
    const ok = await postJSON('/api/equipment/maintenance', {
      equipment_id: equipId,
      service_date: localDate(),
      type: mType, cost: mCost,
      notes: mNotes.trim(),
      receipt_reference: mReceipt.trim() || null,
      cook_id: cookId || null,
      location_id: locationId,
    });
    if (!ok) return;
    setMType('Repair'); setMCost(''); setMNotes(''); setMReceipt('');
    router.refresh();
  };

  const handleAddPart = async (e: React.FormEvent, equipId: number) => {
    e.preventDefault();
    if (!pPartNum.trim()) return;
    const ok = await postJSON('/api/equipment/parts', {
      equipment_id: equipId,
      part_number: pPartNum.trim(),
      description: pDesc.trim() || null,
      vendor: pVendor.trim() || null,
      unit_price: pUnitPrice,
      qty_on_hand: pQty,
      last_ordered: pOrdered || null,
      last_order_ref: pOrderRef.trim() || null,
      notes: pNotes.trim() || null,
      location_id: locationId,
    });
    if (!ok) return;
    setPPartNum(''); setPDesc(''); setPVendor(''); setPUnitPrice('');
    setPQty(''); setPOrdered(''); setPOrderRef(''); setPNotes('');
    setAddPartFor(null);
    router.refresh();
  };

  const handleAddSchedule = async (e: React.FormEvent, equipId: number) => {
    e.preventDefault();
    if (!sTask.trim()) return;
    const ok = await postJSON('/api/equipment/schedule', {
      equipment_id: equipId,
      task: sTask.trim(), frequency: sFreq,
      last_done: sLastDone || null,
      next_due: sNextDue || null,
      notes: sNotes.trim() || null,
      location_id: locationId,
    });
    if (!ok) return;
    setSTask(''); setSFreq('Monthly'); setSLastDone(''); setSNextDue(''); setSNotes('');
    setAddSchedFor(null);
    router.refresh();
  };

  const partsByEquip = (id: number) => parts.filter(p => p.equipment_id === id);
  const schedByEquip = (id: number) => schedule.filter(s => s.equipment_id === id);

  const toggleExpand = (id: number) => {
    setExpandedId(expandedId === id ? null : id);
    setActiveTab('details');
    setAddPartFor(null);
    setAddSchedFor(null);
  };

  return (
    <div>
      <div className="flex-between mb-20">
        <div>
          <h1>Equipment</h1>
          <p className="subtitle">Your gear, parts, schedules, manuals, and what it&apos;s costing you.</p>
        </div>
        <button className="btn primary" onClick={() => setShowAdd(!showAdd)}>Add a piece</button>
      </div>

      {err && <div className="card border-red mb-20" style={{ color: 'var(--red)' }}>{err}</div>}

      {showAdd && (
        <form onSubmit={handleAddEquipment} className="card form-row mb-20 border-yellow">
          <div style={{ flex: '2 1 200px' }}>
            <label className="label">Name</label>
            <input className="input form-field" value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Rational Alto Shaam" required />
          </div>
          <div style={{ flex: '1 1 120px' }}>
            <label className="label">Category</label>
            <select className="input form-field" value={category} onChange={e=>setCategory(e.target.value)}>
              <option>Ovens</option><option>Refrigeration</option><option>Prep &amp; Mixers</option>
              <option>Fryers</option><option>Smallwares</option><option>Tools</option><option>Other</option>
            </select>
          </div>
          <div style={{ flex: '1 1 150px' }}>
            <label className="label">Make / Model</label>
            <input className="input form-field" value={makeModel} onChange={e=>setMakeModel(e.target.value)} placeholder="e.g. Vulcan VC44GD" />
          </div>
          <div style={{ flex: '1 1 150px' }}>
            <label className="label">Model number</label>
            <input className="input form-field" value={modelNumber} onChange={e=>setModelNumber(e.target.value)} placeholder="OEM model #" />
          </div>
          <div style={{ flex: '1 1 150px' }}>
            <label className="label">Serial number</label>
            <input className="input form-field" value={serial} onChange={e=>setSerial(e.target.value)} />
          </div>
          <div style={{ flex: '1 1 150px' }}>
            <label className="label">Vendor</label>
            <input className="input form-field" value={vendor} onChange={e=>setVendor(e.target.value)} placeholder="WebstaurantStore, Sysco, …" />
          </div>
          <div style={{ flex: '1 1 150px' }}>
            <label className="label">Order / invoice #</label>
            <input className="input form-field" value={orderRef} onChange={e=>setOrderRef(e.target.value)} placeholder="#WS-12345" />
          </div>
          <div style={{ flex: '1 1 150px' }}>
            <label className="label">Purchase cost $</label>
            <input type="number" className="input form-field" value={cost} onChange={e=>setCost(e.target.value)} />
          </div>
          <div style={{ flex: '1 1 150px' }}>
            <label className="label">Purchased on</label>
            <input type="date" className="input form-field" value={purchaseDate} onChange={e=>setPurchaseDate(e.target.value)} />
          </div>
          <div style={{ flex: '1 1 150px' }}>
            <label className="label">Warranty until</label>
            <input type="date" className="input form-field" value={warranty} onChange={e=>setWarranty(e.target.value)} />
          </div>
          <div style={{ flex: '2 1 300px' }}>
            <label className="label">Manual (file path or URL)</label>
            <input className="input form-field" value={manualPath} onChange={e=>setManualPath(e.target.value)} placeholder="data/originals/equipment_manuals/vulcan_vc44gd.pdf" />
          </div>
          <div style={{ flex: '3 1 100%' }}>
            <label className="label">Notes</label>
            <textarea className="input form-field" rows={2} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="quirks, install notes, gas line, breaker, anything useful" />
          </div>
          <button type="submit" className="btn primary" disabled={saving}>Save</button>
        </form>
      )}

      {equipment.length === 0 && <div className="empty">Nothing here yet.</div>}

      <div className="stack" style={{ gap: 16 }}>
        {equipment.map(e => {
          const p = partsByEquip(e.id);
          const s = schedByEquip(e.id);
          const overdue = s.some(x => isOverdue(x.next_due));
          const isOpen = expandedId === e.id;
          return (
            <div key={e.id} className="card">
              <div className="flex-between" style={{ cursor: 'pointer' }} onClick={() => toggleExpand(e.id)}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{e.name}</div>
                  <div className="meta">
                    {e.category}
                    {e.make_model ? ` · ${e.make_model}` : ''}
                    {e.model_number ? ` · Model ${e.model_number}` : ''}
                    {e.serial_number ? ` · SN ${e.serial_number}` : ''}
                    {e.vendor ? ` · ${e.vendor}` : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="text-red font-bold">${USD(e.maintenance_cost || 0)} <span className="meta">Maint</span></div>
                  {e.purchase_cost != null && <div className="meta">${USD(e.purchase_cost)} Capital</div>}
                  {e.warranty_expiration != null && (() => {
                    const expired = isWarrantyExpired(e.warranty_expiration);
                    return (
                      <div className="meta" style={expired ? { color: 'var(--red)' } : undefined}>
                        Warranty: {formatDate(e.warranty_expiration)}{expired ? ' (expired)' : ''}
                      </div>
                    );
                  })()}
                  {overdue && <div className="meta" style={{ color: 'var(--red)' }}>Service overdue</div>}
                  {p.length > 0 && <div className="meta">{p.length} part{p.length === 1 ? '' : 's'} on file</div>}
                </div>
              </div>

              {isOpen && (
                <div className="mt-12 pt-12" style={{ borderTop: '1px solid var(--border)' }}>
                  <div className="flex-center-gap mb-20" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <button className={`btn ${activeTab==='details'?'primary':''}`} onClick={()=>setActiveTab('details')}>Details</button>
                    <button className={`btn ${activeTab==='parts'?'primary':''}`} onClick={()=>setActiveTab('parts')}>Parts ({p.length})</button>
                    <button className={`btn ${activeTab==='schedule'?'primary':''}`} onClick={()=>setActiveTab('schedule')}>Schedule ({s.length})</button>
                    <button className={`btn ${activeTab==='log'?'primary':''}`} onClick={()=>setActiveTab('log')}>Log repair</button>
                  </div>

                  {activeTab === 'details' && (
                    <div className="meta" style={{ lineHeight: 1.7 }}>
                      {e.vendor_order_ref && <div>Order/invoice: <strong>{e.vendor_order_ref}</strong></div>}
                      {e.purchase_date && <div>Purchased: {formatDate(e.purchase_date)}</div>}
                      {e.manual_path && (
                        <div>
                          Manual: <a href={`/${e.manual_path.replace(/^\//, '')}`} target="_blank" rel="noreferrer">{e.manual_path}</a>
                        </div>
                      )}
                      {e.notes && <div style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>{e.notes}</div>}
                      {!e.vendor_order_ref && !e.purchase_date && !e.manual_path && !e.notes && (
                        <div style={{ fontStyle: 'italic' }}>No extra details recorded yet.</div>
                      )}
                    </div>
                  )}

                  {activeTab === 'parts' && (
                    <div>
                      {p.length === 0 && <div className="meta" style={{ fontStyle: 'italic' }}>No parts on file.</div>}
                      {p.map(part => (
                        <div key={part.id} className="mb-20" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                          <div style={{ fontWeight: 600 }}>
                            {part.part_number}{part.description ? ` — ${part.description}` : ''}
                          </div>
                          <div className="meta">
                            {part.vendor ? `${part.vendor} · ` : ''}
                            {part.unit_price != null ? `$${USD(part.unit_price)} ea · ` : ''}
                            {part.qty_on_hand != null ? `${part.qty_on_hand} on hand · ` : ''}
                            {part.last_ordered ? `last ordered ${formatDate(part.last_ordered)}` : ''}
                            {part.last_order_ref ? ` (${part.last_order_ref})` : ''}
                          </div>
                          {part.notes && <div className="meta" style={{ whiteSpace: 'pre-wrap' }}>{part.notes}</div>}
                        </div>
                      ))}
                      {addPartFor === e.id ? (
                        <form onSubmit={ev => handleAddPart(ev, e.id)} className="form-row mt-12">
                          <div style={{ flex: '1 1 150px' }}>
                            <label className="label">Part number</label>
                            <input className="input form-field" value={pPartNum} onChange={e=>setPPartNum(e.target.value)} required />
                          </div>
                          <div style={{ flex: '2 1 250px' }}>
                            <label className="label">Description</label>
                            <input className="input form-field" value={pDesc} onChange={e=>setPDesc(e.target.value)} placeholder="e.g. compressor relay" />
                          </div>
                          <div style={{ flex: '1 1 150px' }}>
                            <label className="label">Vendor</label>
                            <input className="input form-field" value={pVendor} onChange={e=>setPVendor(e.target.value)} />
                          </div>
                          <div style={{ flex: '1 1 100px' }}>
                            <label className="label">Unit $</label>
                            <input type="number" className="input form-field" value={pUnitPrice} onChange={e=>setPUnitPrice(e.target.value)} />
                          </div>
                          <div style={{ flex: '1 1 100px' }}>
                            <label className="label">Qty on hand</label>
                            <input type="number" className="input form-field" value={pQty} onChange={e=>setPQty(e.target.value)} />
                          </div>
                          <div style={{ flex: '1 1 150px' }}>
                            <label className="label">Last ordered</label>
                            <input type="date" className="input form-field" value={pOrdered} onChange={e=>setPOrdered(e.target.value)} />
                          </div>
                          <div style={{ flex: '1 1 150px' }}>
                            <label className="label">Order ref</label>
                            <input className="input form-field" value={pOrderRef} onChange={e=>setPOrderRef(e.target.value)} />
                          </div>
                          <div style={{ flex: '3 1 100%' }}>
                            <label className="label">Notes</label>
                            <textarea className="input form-field" rows={2} value={pNotes} onChange={e=>setPNotes(e.target.value)} />
                          </div>
                          <div className="flex-center-gap mt-20" style={{ gap: 8 }}>
                            <button type="submit" className="btn primary" disabled={saving}>Save part</button>
                            <button type="button" className="btn" onClick={()=>setAddPartFor(null)}>Cancel</button>
                          </div>
                        </form>
                      ) : (
                        <button className="btn" style={{ marginTop: 8, color: 'var(--blue)' }} onClick={()=>setAddPartFor(e.id)}>+ Add a part</button>
                      )}
                    </div>
                  )}

                  {activeTab === 'schedule' && (
                    <div>
                      {s.length === 0 && <div className="meta" style={{ fontStyle: 'italic' }}>No scheduled maintenance.</div>}
                      {s.map(item => (
                        <div key={item.id} className="mb-20" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                          <div style={{ fontWeight: 600 }}>{item.task}</div>
                          <div className="meta" style={isOverdue(item.next_due) ? { color: 'var(--red)' } : undefined}>
                            Every {item.frequency.toLowerCase()}
                            {item.last_done ? ` · last done ${formatDate(item.last_done)}` : ''}
                            {item.next_due ? ` · next due ${formatDate(item.next_due)}` : ''}
                            {isOverdue(item.next_due) ? ' (overdue)' : ''}
                          </div>
                          {item.notes && <div className="meta" style={{ whiteSpace: 'pre-wrap' }}>{item.notes}</div>}
                        </div>
                      ))}
                      {addSchedFor === e.id ? (
                        <form onSubmit={ev => handleAddSchedule(ev, e.id)} className="form-row mt-12">
                          <div style={{ flex: '2 1 250px' }}>
                            <label className="label">Task</label>
                            <input className="input form-field" value={sTask} onChange={e=>setSTask(e.target.value)} placeholder="e.g. Change fryer filter" required />
                          </div>
                          <div style={{ flex: '1 1 120px' }}>
                            <label className="label">Frequency</label>
                            <select className="input form-field" value={sFreq} onChange={e=>setSFreq(e.target.value)}>
                              <option>Daily</option><option>Weekly</option><option>Biweekly</option>
                              <option>Monthly</option><option>Quarterly</option><option>Annually</option>
                            </select>
                          </div>
                          <div style={{ flex: '1 1 150px' }}>
                            <label className="label">Last done</label>
                            <input type="date" className="input form-field" value={sLastDone} onChange={e=>setSLastDone(e.target.value)} />
                          </div>
                          <div style={{ flex: '1 1 150px' }}>
                            <label className="label">Next due</label>
                            <input type="date" className="input form-field" value={sNextDue} onChange={e=>setSNextDue(e.target.value)} />
                          </div>
                          <div style={{ flex: '3 1 100%' }}>
                            <label className="label">Notes</label>
                            <textarea className="input form-field" rows={2} value={sNotes} onChange={e=>setSNotes(e.target.value)} />
                          </div>
                          <div className="flex-center-gap mt-20" style={{ gap: 8 }}>
                            <button type="submit" className="btn primary" disabled={saving}>Save schedule</button>
                            <button type="button" className="btn" onClick={()=>setAddSchedFor(null)}>Cancel</button>
                          </div>
                        </form>
                      ) : (
                        <button className="btn" style={{ marginTop: 8, color: 'var(--blue)' }} onClick={()=>setAddSchedFor(e.id)}>+ Add scheduled task</button>
                      )}
                    </div>
                  )}

                  {activeTab === 'log' && (
                    <form onSubmit={ev => handleAddMaintenance(ev, e.id)} className="form-row">
                      <div style={{ flex: '1 1 120px' }}>
                        <label className="label">Type</label>
                        <select className="input form-field" value={mType} onChange={e=>setMType(e.target.value)}>
                          <option>Repair</option><option>Routine</option><option>Damage</option>
                        </select>
                      </div>
                      <div style={{ flex: '1 1 100px' }}>
                        <label className="label">Cost $</label>
                        <input type="number" className="input form-field" value={mCost} onChange={e=>setMCost(e.target.value)} required />
                      </div>
                      <div style={{ flex: '2 1 200px' }}>
                        <label className="label">What happened</label>
                        <input className="input form-field" value={mNotes} onChange={e=>setMNotes(e.target.value)} placeholder="e.g. Replaced compressor relay" required />
                      </div>
                      <div style={{ flex: '2 1 200px' }}>
                        <label className="label">Receipt or invoice number</label>
                        <input className="input form-field" value={mReceipt} onChange={e=>setMReceipt(e.target.value)} placeholder="e.g. invoice #94911" />
                      </div>
                      <button type="submit" className="btn primary" disabled={saving}>Log</button>
                    </form>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
