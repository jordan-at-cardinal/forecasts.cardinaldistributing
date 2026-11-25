"""Export existing Cardinal Forecast SQLite data to a browser-importable JSON backup.
Usage: python migrate_desktop_db.py path/to/forecast.db
Read-only: never changes the existing database.
"""
import sqlite3, sys, json, datetime as dt
from pathlib import Path

if len(sys.argv) != 2:
    raise SystemExit('Usage: python migrate_desktop_db.py /path/to/forecast.db')
p=Path(sys.argv[1]).expanduser().resolve()
if not p.is_file(): raise SystemExit(f'File not found: {p}')
conn=sqlite3.connect(f'file:{p.as_posix()}?mode=ro',uri=True)
conn.row_factory=sqlite3.Row
names={r[0] for r in conn.execute('SELECT name FROM sqlite_master WHERE type="table"')}
required={'inventory','sales'}
if not required.issubset(names):raise SystemExit('This is not a Cardinal Forecast database: required tables missing.')

def records(sql):return [dict(x) for x in conn.execute(sql)]
def today_iso(s):
    s=str(s or '').strip()
    for fmt in ('%Y%m%d','%Y-%m-%d','%m/%d/%Y'):
        try:return dt.datetime.strptime(s,fmt).date().isoformat()
        except ValueError:pass
    return None

def supplier(name):
    if name not in suppliers:
        suppliers[name]={'supplier':name,'inventory':[],'sales':[],'coverage':[],'lead_days':None,'snapshots':[],'inventory_updated_at':None,'sales_updated_at':None}
    return suppliers[name]

suppliers={}
columns={r['name'] for r in conn.execute('PRAGMA table_info(inventory)')}
if 'inventory_latest' in names:
    inv=records('SELECT i.* FROM inventory i JOIN inventory_latest l ON l.product_id=i.product_id AND l.snapshot=i.snapshot')
else:
    inv=records('SELECT i.* FROM inventory i JOIN (SELECT product_id,MAX(snapshot) snapshot FROM inventory GROUP BY product_id) m USING(product_id,snapshot)')
for r in inv:
    s=supplier(r['supplier']);snap=str(r.get('snapshot') or '')
    s['inventory'].append({'id':str(r['product_id']),'name':r.get('name') or '',
         'status':(r.get('status') or '').strip().upper(),
         'supplier':s['supplier'],'available':max(0,float(r.get('available') or 0)),
         'on_order':max(0,float(r.get('on_order') or 0)),
         'arrival':today_iso(r.get('arrival')),'next_po_quantity':max(0,float(r['next_po_quantity'])) if r.get('next_po_quantity') is not None else None,
         'last_sale_date':today_iso(r.get('last_sale_date')),'snapshot_at':snap})
    s['inventory_updated_at']=max(s['inventory_updated_at'] or '',snap) or None
sales_cols={r['name'] for r in conn.execute('PRAGMA table_info(sales)')}
if 'actual_cases' not in sales_cols:raise SystemExit('Reimport the updated sales report first: this database has no physical Units Sold column.')
skipped=0
for r in records('SELECT product_id,name,supplier,period,week,actual_cases FROM sales'):
    if r.get('actual_cases') is None:skipped+=1;continue
    s=supplier(r['supplier']);s['sales'].append({'id':str(r['product_id']),'name':r.get('name') or '',
     'supplier':s['supplier'],'period':today_iso(r['period']),'week':int(r['week']),
     'units':max(0,float(r['actual_cases']))})
if 'sales_coverage' in names:
    for r in records('SELECT supplier,period FROM sales_coverage'):
        d=today_iso(r['period'])
        if d:supplier(r['supplier'])['coverage'].append(d)
if 'supplier_settings' in names:
    for r in records('SELECT supplier,lead_days FROM supplier_settings'):
        supplier(r['supplier'])['lead_days']=r['lead_days']
for r in suppliers.values():
    r['coverage']=sorted(set(r['coverage']))
output=Path.cwd()/'cardinal_forecast_desktop_migration.json'
output.write_text(json.dumps({'version':1,'created_at':dt.datetime.now(dt.timezone.utc).isoformat(),
 'suppliers':list(suppliers.values()),'preferences':{'safety_pct':15,'status_filter':'All eligible'}},
 ensure_ascii=False),encoding='utf-8')
print('Wrote',output,'for',len(suppliers),'suppliers; legacy CE-only rows excluded:',skipped)
print('Upload this JSON with the Restore backup button on the new GitHub Pages website.')
