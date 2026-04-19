// screens-portals.jsx - Timesheet, Invoice OCR, Expenses
const Timesheet = () => (
  <>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
      <h3>CC · Week 17 · Apr 13–19, 2026</h3>
      <span className="tag">draft</span>
      <ExcelPill state="synced" label="XLSX · Timesheet.xlsx · synced"/>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
        <SketchBtn small>← week</SketchBtn>
        <SketchBtn small>week →</SketchBtn>
        <SketchBtn small>copy last week</SketchBtn>
        <SketchBtn small primary>Submit for approval</SketchBtn>
      </div>
    </div>
    <div className="sketch-box">
      <table className="ts-grid">
        <thead>
          <tr>
            <th style={{ width: 240, textAlign: 'left' }}>Project / activity</th>
            <th>Mon 13</th><th>Tue 14</th><th>Wed 15</th><th>Thu 16</th><th>Fri 17</th><th>Sat</th><th>Sun</th>
            <th style={{ width: 60 }}>Total</th>
            <th style={{ width: 80 }}>$ accr.</th>
          </tr>
        </thead>
        <tbody>
          {[
            ['IFM001 · Diligence Strategy','delivery',8,8,7,8,6,0,0,37,3700],
            ['GNC001 · Portfolio Review','delivery',0,0,2,0,3,0,0,5,500],
            ['PNC002 · Proposal','BD',0,2,1,2,0,0,0,5,0],
            ['Firm building · Website',' OPEX',0,0,0,0,2,0,0,2,0],
          ].map((r,i)=>(
            <tr key={i}>
              <td className="proj">
                <span className="code" style={{ fontSize: 11, background: 'var(--paper-2)', padding: '1px 4px', borderRadius: 3 }}>{r[0].split(' · ')[0]}</span>
                {' '}{r[0].split(' · ')[1]} <span className="tag" style={{ fontSize: 10 }}>{r[1]}</span>
              </td>
              {r.slice(2, 9).map((h,j)=>(<td key={j}><input defaultValue={h || ''} /></td>))}
              <td><b>{r[9]}h</b></td>
              <td className="small">${r[10]}</td>
            </tr>
          ))}
          <tr>
            <td className="proj" style={{ fontStyle: 'italic', color: 'var(--ink-faint)' }}>＋ add project row</td>
            <td colSpan="9"></td>
          </tr>
          <tr className="total">
            <td className="proj">Daily total</td>
            <td>8</td><td>10</td><td>10</td><td>10</td><td>11</td><td>0</td><td>0</td><td>49h</td><td>$4,200</td>
          </tr>
        </tbody>
      </table>
      <div style={{ display: 'flex', gap: 10, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="tag yellow">⚠ Fri 11h &gt; 10h soft cap</span>
        <span className="tag green">✓ all rows have project codes</span>
        <span className="tag">💾 autosaves on blur</span>
        <span className="small" style={{ marginLeft: 'auto', fontFamily: 'var(--mono)' }}>bulk paste from Excel? just Ctrl+V in any cell →</span>
      </div>
    </div>
    <div className="grid g3" style={{ marginTop: 10 }}>
      <div className="sketch-box">
        <h4>Your utilisation</h4>
        <PenLine/>
        <div style={{ fontFamily: 'var(--hand-title)', fontSize: 42 }}>84%</div>
        <div className="small">week 17 · target 65–80%</div>
        <div style={{ marginTop: 6 }}>
          <Bar label="Delivery" pct={76} val="37h"/>
          <Bar label="BD" pct={10} val="5h" tone="blue"/>
          <Bar label="Firm build" pct={4} val="2h" tone="green"/>
        </div>
      </div>
      <div className="sketch-box sketch-box-2">
        <h4>Quick-add via ⌘K</h4>
        <PenLine/>
        <div className="code" style={{ background: 'var(--paper-2)', padding: 8, borderRadius: 4 }}>IFM001 thu 8</div>
        <div className="small" style={{ marginTop: 6 }}>parsed: project IFM001 · Thu 16 · 8h delivery</div>
        <div className="code" style={{ background: 'var(--paper-2)', padding: 8, borderRadius: 4, marginTop: 6 }}>bd pnc002 tue 2h</div>
        <Sticky rot={-1} style={{ marginTop: 10 }}>Forgot to log last week? The system nudges Fridays at 4pm.</Sticky>
      </div>
      <div className="sketch-box sketch-box-3">
        <h4>Approval status</h4>
        <PenLine/>
        <div className="list-row"><span>Wk 17 · this week</span><span className="tag">draft</span></div>
        <div className="list-row"><span>Wk 16 · Apr 6–12</span><span className="tag green">approved · MB</span></div>
        <div className="list-row"><span>Wk 15 · Mar 30–5</span><span className="tag green">approved</span></div>
        <div className="list-row"><span>Wk 14 · Mar 23–29</span><span className="tag yellow">1 flag resolved</span></div>
      </div>
    </div>
  </>
);

const InvoiceOCR = () => (
  <>
    <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
      <h3>Invoice intake</h3>
      <span className="tag">6 in queue</span>
      <ExcelPill state="synced" label="XLSX · Invoices.xlsx"/>
      <div className="small" style={{ marginLeft: 'auto' }}>📬 forward PDFs to <span className="code">invoices@foundry.health</span></div>
    </div>
    <div className="grid g-3-1">
      <div>
        <div className="dropzone big" style={{ marginBottom: 10 }}>
          <h3>drop PDFs here ⇣</h3>
          <div className="small">or paste from clipboard · or forward to email inbox · or sync from /Invoices/Inbox/</div>
          <div style={{ marginTop: 10, display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            <span className="tag">✓ OCR consultant invoices</span>
            <span className="tag">✓ supplier invoices</span>
            <span className="tag">✓ receipts → expenses</span>
          </div>
        </div>

        <DividerLbl>Review extracted — Hawksparks-Apr2026.pdf</DividerLbl>
        <div className="ocr-split">
          <div className="ocr-pdf">
            <div className="small" style={{ color: 'var(--ink-faint)' }}>PDF · page 1 of 1 · 94% OCR confidence</div>
            <div style={{ border: '1px solid var(--line-soft)', padding: 12, marginTop: 6, minHeight: 380, background: 'repeating-linear-gradient(0deg, transparent 0 18px, rgba(0,0,0,.04) 18px 19px)', position: 'relative' }}>
              <div style={{ fontFamily: 'var(--hand-title)', fontSize: 24 }}>HAWKSPARKS PTY LTD</div>
              <div className="small">ABN 12 345 678 910 · Level 4, 220 Clarence St, Sydney</div>
              <hr style={{ margin: '8px 0' }}/>
              <div style={{ position: 'relative', padding: '4px 6px', background: 'rgba(255,245,157,.5)', border: '1.5px dashed var(--accent-blue)', display: 'inline-block' }}>Invoice # HS-2041</div>
              <div style={{ marginTop: 6 }}>Date: <span style={{ background: 'rgba(255,245,157,.5)' }}>18 April 2026</span></div>
              <div>Bill to: Foundry Health Pty Ltd</div>
              <div>Ref: <span style={{ background: 'rgba(200,230,201,.6)', border: '1.5px dashed var(--accent-green)' }}>IFM001 — Diligence Strategy</span></div>
              <table style={{ width: '100%', marginTop: 14, fontSize: 13 }}>
                <thead><tr style={{ borderBottom: '1px solid var(--line)' }}><th align="left">Item</th><th align="right">Qty</th><th align="right">Rate</th><th align="right">Amt</th></tr></thead>
                <tbody>
                  <tr><td>Expert advisory (US pharma)</td><td align="right">8h</td><td align="right">$250</td><td align="right">$2,000</td></tr>
                  <tr><td>Research subscription</td><td align="right">1</td><td align="right">$400</td><td align="right">$400</td></tr>
                  <tr><td></td><td></td><td align="right"><b>Total (AUD)</b></td><td align="right" style={{ background: 'rgba(255,245,157,.5)' }}><b>$2,400</b></td></tr>
                </tbody>
              </table>
              <span className="anno" style={{ bottom: 30, right: 20, transform: 'rotate(6deg)' }}>system highlights extracted fields ↗</span>
            </div>
          </div>
          <div className="ocr-fields">
            <div className="section-label">EXTRACTED · edit anything</div>
            <div className="field"><label>Supplier</label><div className="v">Hawksparks Pty Ltd <span className="conf">96%</span></div></div>
            <div className="field"><label>ABN</label><div className="v">12 345 678 910 <span className="conf">99%</span></div></div>
            <div className="field"><label>Invoice #</label><div className="v">HS-2041 <span className="conf">99%</span></div></div>
            <div className="field"><label>Invoice date</label><div className="v">18 Apr 2026 <span className="conf">95%</span></div></div>
            <div className="field"><label>Due date</label><div className="v">18 May 2026 <span className="conf low">65% · infer +30d?</span></div></div>
            <div className="field"><label>Amount (AUD)</label><div className="v">$2,400.00 <span className="conf">99%</span></div></div>
            <div className="field"><label>GST</label><div className="v">— <span className="conf low">not found · add?</span></div></div>
            <div className="field">
              <label>Match to project</label>
              <div className="v" style={{ background: 'var(--highlight-green)' }}>IFM001 · Integrated Market — Diligence <span className="conf">auto-matched</span></div>
            </div>
            <div className="field">
              <label>Expense category</label>
              <div className="v">Experts (p/h) <span className="conf">suggested</span></div>
            </div>
            <PenLine/>
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              <SketchBtn small>skip</SketchBtn>
              <SketchBtn small>save draft</SketchBtn>
              <SketchBtn small primary>approve &amp; post to IFM001 →</SketchBtn>
            </div>
            <div className="small" style={{ marginTop: 8, color: 'var(--ink-soft)' }}>
              posting will: 1) add to <span className="code">Invoices.xlsx</span> 2) update IFM001 P&amp;L (experts line) 3) route for payment (TT approval · over $2k)
            </div>
          </div>
        </div>
      </div>

      <div>
        <div className="sketch-box" style={{ marginBottom: 10 }}>
          <h4>Queue (6)</h4>
          <PenLine/>
          {[
            ['Hawksparks-Apr2026.pdf','IFM001','$2,400','reviewing','yellow'],
            ['AP-invoice-0043.pdf','IFM001','$15,000','needs match',''],
            ['WorkClub-Apr.pdf','OPEX','$2,800','auto-categ.','green'],
            ['ExpertNet-Q1.pdf','?','$4,200','needs match','pink'],
            ['FinXL-Tax-Mar.pdf','OPEX','$1,650','auto-categ.','green'],
            ['SR-consultant-Mar.pdf','GNC001','$48,000','reviewing','yellow'],
          ].map((r,i)=>(
            <div className="list-row" key={i}>
              <span className="small" style={{ fontFamily: 'var(--mono)' }}>{r[0]}</span>
              <span><span className={`tag ${r[4]}`}>{r[1]}</span> <b>{r[2]}</b></span>
            </div>
          ))}
        </div>
        <Sticky tone="blue">
          <b>How the OCR works</b><br/>
          1. upload/email PDF<br/>
          2. extract fields + suggest project<br/>
          3. human confirms · fields editable<br/>
          4. post → Excel + P&amp;L live
        </Sticky>
      </div>
    </div>
  </>
);

const ExpenseUpload = () => (
  <>
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
      <h3>Log an expense</h3>
      <ExcelPill state="synced" label="XLSX · Expenses.xlsx"/>
      <div className="small" style={{ marginLeft: 'auto' }}>tip: email receipts to <span className="code">receipts@foundry.health</span></div>
    </div>
    <div className="grid g-1-2">
      <div className="dropzone" style={{ minHeight: 360 }}>
        <h3>drop receipts ⇣</h3>
        <div className="small">or snap a photo from mobile app</div>
        <div style={{ marginTop: 20, border: '1.5px dashed var(--line-soft)', padding: 14, background: 'var(--paper)' }}>
          <div className="section-label">Uploaded</div>
          <div className="list-row"><span>📸 taxi-airport.jpg</span><span className="small">$52</span></div>
          <div className="list-row"><span>📄 dinner-gnc-client.pdf</span><span className="small">$186</span></div>
          <div className="list-row"><span>📸 flights-syd-mel.png</span><span className="small">$420</span></div>
        </div>
      </div>
      <div className="sketch-box">
        <h4>New expense · auto-populated</h4>
        <PenLine/>
        <div className="grid g2" style={{ gap: 10 }}>
          <div className="field"><label>Date</label><div className="v">14 Apr 2026</div></div>
          <div className="field"><label>Amount (AUD)</label><div className="v">$186.00</div></div>
          <div className="field"><label>Merchant</label><div className="v">Bistro Guillaume</div></div>
          <div className="field"><label>Category</label><div className="v">Meals & ent.</div></div>
          <div className="field"><label>Project / OPEX</label><div className="v" style={{ background: 'var(--highlight-green)' }}>GNC001</div></div>
          <div className="field"><label>Billable?</label><div className="v">Yes · client dinner</div></div>
          <div className="field"><label>Attendees</label><div className="v">MB, SR, client×2</div></div>
          <div className="field"><label>Payment</label><div className="v">Amex ••4211 (TT)</div></div>
        </div>
        <Sticky tone="pink" rot={1} style={{ marginTop: 10 }}>
          ⚠ Meals &gt; $150/head — needs partner approval per policy
        </Sticky>
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 10 }}>
          <SketchBtn small>save draft</SketchBtn>
          <SketchBtn small primary>submit + sync to GNC001 →</SketchBtn>
        </div>
      </div>
    </div>
    <DividerLbl>This month · $3,240 logged</DividerLbl>
    <table className="sketch-table">
      <thead><tr><th>Date</th><th>Merchant</th><th>Category</th><th>Project</th><th>Amount</th><th>By</th><th>Status</th><th>Receipt</th></tr></thead>
      <tbody>
        {[
          ['14 Apr','Bistro Guillaume','Meals','GNC001','$186','MB','pending',''],
          ['12 Apr','Qantas','Travel','IFM001','$420','CC','approved','📎'],
          ['10 Apr','Uber','Travel','IFM001','$52','CC','approved','📎'],
          ['08 Apr','WorkClub','OPEX','—','$2,800','JS','approved','📎'],
          ['05 Apr','Zoom','Subs · OPEX','—','$89','JS','approved','📎'],
        ].map((r,i)=>(<tr key={i}><td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td><td className="code">{r[3]}</td><td>{r[4]}</td><td>{r[5]}</td><td><span className={`tag ${r[6]==='approved'?'green':'yellow'}`}>{r[6]}</span></td><td>{r[7]}</td></tr>))}
      </tbody>
    </table>
  </>
);

Object.assign(window, { Timesheet, InvoiceOCR, ExpenseUpload });
