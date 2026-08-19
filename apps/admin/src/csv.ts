/**
 * 客户端 CSV 导出：当前页数据原样落盘。
 * 加 UTF-8 BOM 保证 Excel 打开中文不乱码；单元格含逗号/引号/换行时按 RFC 4180 转义。
 */
export function downloadCsv(filename: string, headers: string[], rows: unknown[][]): void {
  const escape = (v: unknown): string => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = '\uFEFF' + [headers, ...rows].map((row) => row.map(escape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
