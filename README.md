# ReadingCenter

個人書庫與閱讀紀錄 PWA，使用 React、TypeScript、Vite、IndexedDB 與可選的 Worker 後端。

## 本機開發與測試

CI 使用 Node.js 24。首次安裝執行 npm ci，之後 npm run dev。

品質檢查：npm run typecheck、npm run lint、npm test、npm run build。
瀏覽器檢查：先安裝 Playwright Chromium／WebKit，再執行 npm run test:e2e。

測試應使用合成資料與 loopback，不能指向正式書庫。靜態預覽不包含 Worker API；完整登入與保存需另行設定自己的後端。

## 設定與部署

此副本不含正式 Cloudflare 綁定、私人資料或既有 Git 歷史；CI 不部署網站。密鑰只可放在本機忽略檔或秘密管理服務。package.json 的 private:true 是避免發布到 npm，不限制 GitHub 儲存庫可見性。

worker/metadata-review-preview.ts 使用不可連線的範例網址，測試透過 mock 執行；使用者必須另行配置自己的環境。

尚未選擇授權條款；公開與採用開源授權是不同決策，勿默認任何第三方再利用授權。

## Google 搜尋階段診斷

來源狀態可附書名限定查詢與一般補查的筆數：收到、格式辨識、書名符合。數字只統計每次最多檢視的 8 筆，不是來源完整收錄數量；只回傳固定階段代碼與有界數字，不回傳查詢文字、key、原始回應或任意錯誤。

補查條件、最多兩次請求與共用 12 秒預算維持不變。診斷能區分來源零筆、格式排除、書名不符及未達補查條件；增加診斷不表示任何特定書名的命中率已修復。
