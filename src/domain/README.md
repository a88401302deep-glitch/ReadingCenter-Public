# domain

核心資料模型與不變條件。此目錄不得依賴 React、IndexedDB／Dexie 或 OneDrive／Microsoft Graph。

- `common.ts`：stable ID、時間、revision、schemaVersion、provenance 與安全更新。
- `book.ts`：Book、多語書名／來源識別、顯示名稱回退規則與一般圖片檔封面。
- `collection.ts`：漫畫系列與雜誌刊物；各冊／各期仍是獨立 Book。
- `reading-cycle.ts`：同一本書第 N 次閱讀／重讀。
- `reading-record.ts`、`progress.ts`：單次閱讀事件、時間、時長與進度。
- `reading-content.ts`：畫線、短評、長篇心得。
- `dictionary.ts`：作者、出版社、分類、標籤、來源、媒體類型、裝置。
- `deletion-policy.ts`：關聯刪除、解除關聯與確認規則。

詳細欄位與空值語意見 [`docs/DOMAIN_CONTRACTS.md`](../../docs/DOMAIN_CONTRACTS.md)。
