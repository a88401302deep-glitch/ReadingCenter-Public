import { expect, test } from './fixtures'
for(const width of [360,1024]) test(`credit fields fit their contents and preserve multiple names at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900})
 await page.goto('/')
 await page.getByRole('button',{name:'新增書籍',exact:true}).click()
 await page.getByRole('button',{name:'輸入書名',exact:true}).click()
 await page.getByLabel('出版書名',{exact:true}).fill('姓名欄位合成資料')
 await page.getByRole('button',{name:'儲存',exact:true}).click()
 await page.getByRole('button',{name:'開啟《姓名欄位合成資料》',exact:true}).click()
 await page.getByRole('button',{name:'編輯書籍資料',exact:true}).click()
 const editor=page.locator('.book-form--expanded'), extra=editor.locator('.book-form-extra')
 await extra.scrollIntoViewIfNeeded()
 for(const label of ['原文書名','作者原名（每行一位）','譯者（每行一位）','繪者／插畫者（每行一位）']) {
  const box=(await editor.getByLabel(label,{exact:true}).boundingBox())!
  expect(box.height).toBeGreaterThanOrEqual(44)
  expect(box.height).toBeLessThanOrEqual(60)
 }
 await extra.screenshot({path:test.info().outputPath(`compact-credits-${width}.png`)})
 const translator=editor.getByLabel('譯者（每行一位）'), names='合成譯者甲\n合成譯者乙\n合成譯者丙'
 await translator.fill(names)
 expect((await translator.boundingBox())!.height).toBeGreaterThan(60)
 expect((await translator.boundingBox())!.height).toBeLessThanOrEqual(192)
 expect(await editor.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1)
 await editor.getByRole('button',{name:'儲存',exact:true}).click()
 await page.getByRole('button',{name:'編輯書籍資料',exact:true}).click()
 await expect(translator).toHaveValue(names)
 expect((await translator.boundingBox())!.height).toBeGreaterThan(60)
})
