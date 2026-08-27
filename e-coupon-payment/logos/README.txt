A版專屬CTA badge放這裡（DD.png／CTA.png／GameCTA.png），目前留空、
沿用logos/資料夾（上一層）裡原本的共用CTA圖當A版預設值，找檔規則
見js/editor-main.js的_loadVersionedDefaultImage()。

── 舞台圖(stage-cylinder.png，2026-08新增) ──
這個版本要不要顯示舞台，開關在 configs/theme.json 這個版本的 hasStage(true/false)。
hasStage=true 的版本，圖放這裡（檔名固定 stage-cylinder.png），沒放的話會借用
上一層 logos/stage-cylinder.png 當墊檔；hasStage=false 的版本，這裡放不放圖都沒差，
程式不會去載入、也不會顯示舞台。
