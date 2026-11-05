/**
 * Exportación de cualquier tabla a Excel o PDF. Las librerías se cargan solo al exportar.
 */
import { brand } from '@core/config';

export interface ExportColumn { header: string; value: (row: unknown) => unknown }

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const clean = (v: unknown) => (v == null ? '' : typeof v === 'number' ? v : String(v));

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function exportExcel(title: string, cols: ExportColumn[], rows: unknown[]) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = brand.name;
  const ws = wb.addWorksheet(title.slice(0, 31));
  ws.addRow(cols.map((c) => c.header)).font = { bold: true };
  rows.forEach((r) => ws.addRow(cols.map((c) => clean(c.value(r)))));
  ws.columns.forEach((col, i) => {
    const max = Math.max(cols[i].header.length, ...rows.slice(0, 200).map((r) => String(clean(cols[i].value(r))).length));
    col.width = Math.min(Math.max(10, max + 2), 60);
  });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  const buf = await wb.xlsx.writeBuffer();
  download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${title}-${stamp()}.xlsx`);
}

export async function exportPdf(title: string, cols: ExportColumn[], rows: unknown[]) {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDF({ orientation: cols.length > 6 ? 'landscape' : 'portrait', unit: 'pt' });
  doc.setFontSize(14);
  doc.text(title, 40, 40);
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text(`${brand.company} · ${new Date().toLocaleString(brand.locale)}`, 40, 56);
  autoTable(doc, {
    startY: 70,
    head: [cols.map((c) => c.header)],
    body: rows.map((r) => cols.map((c) => String(clean(c.value(r))))),
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [21, 24, 28] },
    alternateRowStyles: { fillColor: [244, 243, 239] },
  });
  download(doc.output('blob'), `${title}-${stamp()}.pdf`);
}
