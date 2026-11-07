async (page) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto("http://127.0.0.1:7311");
  await page
    .getByRole("combobox", { name: "当前研究项目" })
    .selectOption({ label: "功能验收" });
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".metric-card").length >= 2 &&
      [...document.querySelectorAll(".metric-card [data-chart-state]")].every(
        (chart) => chart.dataset.chartState === "ready",
      ),
  );
  const alignment = await page.evaluate(() => {
    const boxes = [
      ...document.querySelectorAll(".metric-card .panel-head"),
    ].map((element) => element.getBoundingClientRect());
    const h1 = document.querySelector("h1").getBoundingClientRect(),
      cards = document.querySelector(".metric-grid").getBoundingClientRect();
    return {
      titleOffset: Math.abs(h1.x - cards.x),
      cardHeaderOffset: Math.abs(boxes[0].y - boxes[1].y),
      cardHeightOffset: Math.abs(boxes[0].height - boxes[1].height),
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  if (
    alignment.titleOffset > 1 ||
    alignment.cardHeaderOffset > 1 ||
    alignment.cardHeightOffset > 1 ||
    alignment.overflow
  )
    throw new Error("Desktop alignment failed");
  await page.screenshot({
    path: "tests/browser-output/overview-aligned.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "实验记录", exact: true }).click();
  await page.getByRole("button", { name: "曲线基线", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "实验详情" });
  const motion = await drawer.evaluate((element) => ({
    animation: getComputedStyle(element).animationName,
    duration: getComputedStyle(element).animationDuration,
  }));
  if (motion.animation !== "drawer-enter" || motion.duration !== "0.32s")
    throw new Error("Drawer motion missing");
  await drawer.getByRole("button", { name: "系统", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".system-charts [data-chart-state]").length >
        0 &&
      [...document.querySelectorAll(".system-charts [data-chart-state]")].every(
        (chart) => chart.dataset.chartState === "ready",
      ),
  );
  const systemAlignment = await page
    .locator(".system-charts")
    .evaluate((element) => {
      const children = [...element.querySelectorAll("section")].map((child) =>
        child.getBoundingClientRect(),
      );
      return {
        columns:
          getComputedStyle(element).gridTemplateColumns.split(" ").length,
        headerOffset: Math.abs(children[0].y - children[1].y),
      };
    });
  if (systemAlignment.columns !== 2 || systemAlignment.headerOffset > 1)
    throw new Error("System grid alignment failed");
  await drawer.getByRole("button", { name: "关闭详情" }).click();
  await page.locator(".drawer-backdrop.leaving").waitFor({ state: "attached" });
  await drawer.waitFor({ state: "detached" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "曲线基线", exact: true }).click();
  const reduced = await drawer.evaluate(
    (element) => getComputedStyle(element).animationName,
  );
  if (reduced !== "none") throw new Error("Reduced motion ignored");
  await drawer.getByRole("button", { name: "关闭详情" }).click();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 390, height: 844 });
  for (const button of [
    "实验总览",
    "实验记录",
    "对比分析",
    "参数配置",
    "超参数搜索",
    "文件与产物",
  ]) {
    await page.getByRole("button", { name: button, exact: true }).click();
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      )
    )
      throw new Error("Mobile overflow: " + button);
  }
  await page.getByRole("button", { name: "实验记录", exact: true }).click();
  await page.getByRole("button", { name: "曲线基线", exact: true }).click();
  await drawer.getByRole("button", { name: "系统", exact: true }).click();
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw new Error("Mobile drawer overflow");
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".system-charts [data-chart-state]").length >
        0 &&
      [...document.querySelectorAll(".system-charts [data-chart-state]")].every(
        (chart) => chart.dataset.chartState === "ready",
      ),
  );
  await page.screenshot({
    path: "tests/browser-output/system-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await drawer.getByRole("button", { name: "关闭详情" }).click();
  await page.setViewportSize({ width: 1440, height: 1050 });
  if (errors.length) throw new Error(errors.join("\n"));
  return {
    passed: true,
    alignment,
    systemAlignment,
    motion,
    reducedMotion: reduced,
    pageErrors: errors,
  };
};
