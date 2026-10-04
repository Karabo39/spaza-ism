let printing = false;

/** Print only the document in an invisible same-origin frame, leaving the current screen intact. */
export async function printDocument(path: string) {
  if (printing) throw new Error("A print request is already open.");
  const url = new URL(path, window.location.origin);
  if (url.origin !== window.location.origin)
    throw new Error("Invalid print document.");
  printing = true;
  const frame = document.createElement("iframe");
  frame.title = "Document print";
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText =
    "position:fixed;left:-10000px;top:0;width:800px;height:1000px;border:0";
  frame.setAttribute("sandbox", "allow-same-origin allow-modals");
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok)
      throw new Error("Could not load the document for printing.");
    const source = new DOMParser().parseFromString(
      await response.text(),
      "text/html",
    );
    const receipt = source.querySelector("#receipt");
    if (!receipt)
      throw new Error(
        "Document unavailable. Refresh your session and try again.",
      );
    receipt.querySelectorAll("script,iframe").forEach((node) => node.remove());
    document.body.append(frame);
    const doc = frame.contentDocument,
      win = frame.contentWindow;
    if (!doc || !win)
      throw new Error("Printing is unavailable in this browser.");
    doc.open();
    doc.write(
      "<!doctype html><html><head><title>POS INVENTORY document</title></head><body></body></html>",
    );
    doc.close();
    const styles = Array.from(
      source.querySelectorAll('link[rel="stylesheet"],style'),
    );
    const loading = styles.map((style) => {
      const copy = doc.importNode(style, true);
      if (copy.nodeName === "LINK")
        copy.setAttribute(
          "href",
          new URL(copy.getAttribute("href")!, url).href,
        );
      const ready =
        copy.nodeName === "LINK"
          ? new Promise<void>((resolve, reject) => {
              copy.addEventListener("load", () => resolve(), { once: true });
              copy.addEventListener(
                "error",
                () => reject(new Error("Print styles could not load.")),
                { once: true },
              );
            })
          : Promise.resolve();
      doc.head.append(copy);
      return ready;
    });
    doc.body.append(doc.importNode(receipt, true));
    let readinessTimeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all([
          ...loading,
          ...Array.from(doc.images).map((img) => img.decode()),
          doc.fonts.ready,
        ]),
        new Promise((_, reject) => {
          readinessTimeout = setTimeout(
            () =>
              reject(
                new Error(
                  "The print document took too long to load. Please retry.",
                ),
              ),
            30000,
          );
        }),
      ]);
    } finally {
      clearTimeout(readinessTimeout);
    }
    await new Promise<void>((resolve, reject) => {
      // afterprint fires when the print dialog closes, including cancellation.
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error("Print dialog did not finish. Please retry."));
      }, 300000);
      const cleanup = () => {
        clearTimeout(timeout);
        win.removeEventListener("afterprint", done);
      };
      const done = () => {
        cleanup();
        resolve();
      };
      win.addEventListener("afterprint", done, { once: true });
      try {
        win.focus();
        win.print();
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  } finally {
    frame.remove();
    printing = false;
    window.focus();
  }
}
