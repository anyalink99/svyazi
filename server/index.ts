import { createApp } from "./app.js";
import { loadSemanticSpace } from "./semantic/load.js";

const port = Number(process.env.PORT ?? 4174);
const semantic = await loadSemanticSpace();
const app = createApp(semantic);

app.listen(port, () => {
  console.log(`\nСвязи API: http://localhost:${port}`);
  console.log(
    `Модель: ${semantic.metadata.kind} · ${semantic.metadata.vocabularySize.toLocaleString("ru-RU")} слов · ${semantic.metadata.dimension}d\n`
  );
});
