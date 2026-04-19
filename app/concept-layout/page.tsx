'use client';

import { useState } from 'react';

export default function ConceptLayoutPage() {
  const [activeModal, setActiveModal] = useState<string | null>(null);

  // A helper component to render visual pans
  const Pan = ({ size, label, color = '#e2e8f0' }: { size: string, label: string, color?: string }) => {
    // Basic mapping of sizes to flex basis and height to mock hotel pan ratios
    let flexStyle = {};
    if (size === '1/1') flexStyle = { flex: '1 1 100%', minHeight: '240px' };
    if (size === '1/2') flexStyle = { flex: '1 1 48%', minHeight: '240px' };
    if (size === '1/3') flexStyle = { flex: '1 1 31%', minHeight: '240px' };
    if (size === '1/6') flexStyle = { flex: '1 1 31%', minHeight: '115px' }; // Two 1/6 fit inside a 1/3 stack
    if (size === '1/9') flexStyle = { flex: '1 1 31%', minHeight: '75px' }; // Three 1/9 fit inside a 1/3 stack

    return (
      <div style={{
        ...flexStyle,
        backgroundColor: color,
        border: '2px solid #cbd5e1',
        borderRadius: '6px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 'bold',
        color: '#475569',
        boxShadow: 'inset 0 4px 6px rgba(255,255,255,0.5), inset 0 -4px 6px rgba(0,0,0,0.1)'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div>{label}</div>
          <div style={{ fontSize: '11px', opacity: 0.6 }}>{size} Pan</div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ padding: '20px' }}>
      <h1>Interactive 2D Floor Plan (Beta Concept)</h1>
      <p className="subtitle">This is a sandbox layout prototype. Click highlighted stations to view pan layouts.</p>

      {/* 2D Floor Plan Map mock */}
      <div style={{
        border: '4px solid #334155',
        borderRadius: '12px',
        padding: '30px',
        backgroundColor: '#f1f5f9',
        position: 'relative',
        minHeight: '600px',
        marginTop: '30px'
      }}>
        
        {/* Walk-in Cooler block */}
        <div style={{ position: 'absolute', top: 20, left: 20, width: 150, height: 200, background: '#cbd5e1', border: '2px solid #94a3b8', display: 'flex', alignItems:'center', justifyContent: 'center', fontWeight: 'bold', color: '#475569' }}>
          Walk-in Cooler
        </div>

        {/* Hot Line */}
        <div style={{ position: 'absolute', top: 20, right: 20, width: 120, height: 350, background: '#fca5a5', border: '2px solid #ef4444', display: 'flex', alignItems:'center', justifyContent: 'center', fontWeight: 'bold', color: '#991b1b' }}>
          Hot Line Grills
        </div>

        {/* Garde Manger Station (Clickable) */}
        <div 
          onClick={() => setActiveModal('garde')}
          style={{ 
            position: 'absolute', 
            top: 250, 
            left: 200, 
            width: 250, 
            height: 100, 
            background: '#86efac', 
            border: '3px dashed #16a34a', 
            display: 'flex', 
            alignItems:'center', 
            justifyContent: 'center', 
            fontWeight: 'bold', 
            color: '#166534',
            cursor: 'pointer',
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
          }}
        >
          Garde Manger Lowboy (Click Me)
        </div>

      </div>

      {/* Lowboy Interactive Modal */}
      {activeModal === 'garde' && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.6)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 100
        }}>
          <div style={{
            background: 'white',
            borderRadius: '12px',
            padding: '30px',
            width: '900px',
            maxWidth: '90vw',
            boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)'
          }}>
            <div className="flex-between" style={{ marginBottom: '20px' }}>
              <h2>Garde Manger Lowboy Configuration</h2>
              <button className="btn" onClick={() => setActiveModal(null)}>Close</button>
            </div>
            
            <p className="subtitle">Standard two-door refrigerated prep table (2x full hotel pan capacity drop-in view).</p>

            {/* Container representing the top of a prep table */}
            <div style={{
              background: '#e2e8f0',
              border: '12px solid #94a3b8',
              borderRadius: '8px',
              padding: '16px',
              display: 'flex',
              gap: '16px',
              minHeight: '300px'
            }}>
              
              {/* Left Well (Capacity: 1 Full Pan) */}
              <div style={{ flex: 1, display: 'flex', gap: '8px' }}>
                {/* 1/2 Pan */}
                <Pan size="1/2" label="Mixed Greens" color="#bbf7d0" />
                
                {/* 1/2 capacity made up of multiple smaller pans in a column */}
                <div style={{ flex: '1 1 48%', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <Pan size="1/6" label="Cherry Tomatoes" color="#fecaca" />
                  <Pan size="1/6" label="Cucumbers" color="#bbf7d0" />
                </div>
              </div>

              {/* Right Well (Capacity: 1 Full Pan) */}
              <div style={{ flex: 1, display: 'flex', gap: '8px' }}>
                {/* 1/3 stack holding 1/6 and 1/9s */}
                <div style={{ flex: '1 1 31%', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <Pan size="1/3" label="Croutons" color="#fef08a" />
                </div>

                {/* 1/3 stack holding 1/9s */}
                <div style={{ flex: '1 1 31%', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <Pan size="1/9" label="Caesar" color="#fff" />
                    <Pan size="1/9" label="Vinaigrette" color="#fff" />
                    <Pan size="1/9" label="Balsamic" color="#1e293b" />
                </div>

                {/* 1/3 stack */}
                <div style={{ flex: '1 1 31%', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <Pan size="1/6" label="Bacon Bits" color="#fca5a5" />
                    <Pan size="1/6" label="Blue Crumb" color="#bfdbfe" />
                </div>
              </div>

            </div>
            
            <div style={{ marginTop: '20px', fontSize: '13px', color: '#64748b' }}>
              * Layout represents top-down fractional pan inserts inside insulated rails.
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
