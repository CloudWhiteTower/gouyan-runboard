async (page) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:7310");
  await page.getByRole("heading", { name: "指标", exact: true }).waitFor();
  await page.getByRole("button", { name: "实验记录", exact: true }).click();
  await page.getByRole("textbox", { name: "搜索实验" }).fill("线性分类");
  const boxes = page.getByRole("checkbox", { name: /^选择 线性分类/ });
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await page.getByRole("button", { name: "对比实验", exact: true }).click();
  await page.getByRole("heading", { name: "超参数平行坐标" }).waitFor();
  await page
    .getByRole("combobox", { name: "选择曲线指标" })
    .selectOption("train/loss");
  await page.getByRole("button", { name: "参数配置", exact: true }).click();
  await page
    .getByRole("textbox", { name: "名称" })
    .fill("浏览器验收 · 参数版本");
  await page.getByRole("button", { name: "保存版本", exact: true }).click();
  await page
    .getByRole("button", { name: /浏览器验收 · 参数版本/ })
    .first()
    .waitFor();
  await page.getByRole("button", { name: "超参数搜索", exact: true }).click();
  await page.getByRole("button", { name: "新建搜索", exact: true }).click();
  const form = page.getByRole("dialog");
  const study = "浏览器搜索验收-" + Date.now();
  await form.getByRole("textbox", { name: "名称" }).fill(study);
  await form.getByRole("spinbutton", { name: "试验次数" }).fill("2");
  await form.getByRole("textbox", { name: "搜索空间" }).fill(
    JSON.stringify({
      learning_rate: { type: "float", low: 0.02, high: 0.1 },
      epochs: { type: "categorical", choices: [3] },
    }),
  );
  await form.getByRole("button", { name: "创建任务", exact: true }).click();
  const card = page
    .locator(".study-card")
    .filter({ has: page.getByRole("heading", { name: study, exact: true }) });
  await card.getByRole("button", { name: "开始搜索", exact: true }).click();
  await card
    .locator(".status")
    .filter({ hasText: "已完成" })
    .waitFor({ timeout: 60000 });
  await card.locator("summary").click();
  if ((await card.locator("tbody tr").count()) !== 2)
    throw new Error("Expected two completed search trials");
  await page.screenshot({
    path: "tests/browser-output/sweep-verified.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "文件与产物", exact: true }).click();
  await page
    .getByRole("combobox", { name: "选择产物所属实验" })
    .selectOption({ label: "线性分类 · LR 0.2" });
  await page.getByRole("button", { name: "models", exact: true }).click();
  await page.getByRole("link", { name: "下载", exact: true }).waitFor();
  await page.getByRole("button", { name: "接入", exact: true }).click();
  await page.getByRole("button", { name: "Python", exact: true }).click();
  await page.getByRole("button", { name: "Worker", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw new Error("Mobile page overflows");
  await page.screenshot({
    path: "tests/browser-output/mobile-verified.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.getByRole("button", { name: "实验总览", exact: true }).click();
  await page.screenshot({
    path: "tests/browser-output/overview-verified.png",
    fullPage: true,
  });
  if (errors.length) throw new Error(errors.join("\n"));
  return {
    passed: true,
    study,
    checks: [
      "experiment selection",
      "comparison metric switch",
      "config version save",
      "real Optuna training",
      "artifact browsing",
      "integration tabs",
      "390px layout",
    ],
    pageErrors: errors,
  };
}
