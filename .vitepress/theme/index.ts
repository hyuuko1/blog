// .vitepress/theme/index.js
import DefaultTheme from "vitepress/theme";
import "./custom.css";

// export default DefaultTheme;

export default {
  ...DefaultTheme,
  enhanceApp(ctx) {
    DefaultTheme.enhanceApp(ctx);
  },
};
