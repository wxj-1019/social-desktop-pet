export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}

/** 分页控件：上一页/下一页 + 页码 + 总数（服务端已返回 total，前端只翻页） */
export function Pagination({ page, pageSize, total, onChange }: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  return (
    <div className="pagination">
      <button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        上一页
      </button>
      <span className="pagination-info">
        第 {page} / {pages} 页（共 {total} 条）
      </span>
      <button type="button" disabled={page >= pages} onClick={() => onChange(page + 1)}>
        下一页
      </button>
    </div>
  );
}
