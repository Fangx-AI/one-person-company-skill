const http = require("http");

http
  .get("http://127.0.0.1:3000/", (r) => {
    let d = "";
    r.setEncoding("utf8");
    r.on("data", (c) => (d += c));
    r.on("end", () => {
      console.log("STATUS:", r.statusCode);
      console.log("LEN:", d.length);
      const m1 = d.match(/<h1[^>]*class="hero-min__title"[^>]*>([\s\S]*?)<\/h1>/);
      console.log("H1:", m1 ? m1[1].replace(/\s+/g, " ").trim() : "NOT FOUND");
      const m2 = d.match(/<title>([^<]+)<\/title>/);
      console.log("TITLE:", m2 ? m2[1] : "?");
      console.log("has chip-min:", /chip-min/.test(d));
      console.log("has hero-min__composer:", /hero-min__composer/.test(d));
      console.log("has footer-min:", /footer-min/.test(d));
      console.log("has resource-block:", /resource-block/.test(d));
      console.log("has featured-grid:", /featured-grid/.test(d));
      console.log("has topic-library:", /topic-library/.test(d));
      console.log("has north-star-form:", /north-star-form/.test(d));
      console.log("has 押注:", /押注/.test(d));
      console.log("login text 登录:", /id="login-btn"[^>]*>登录</.test(d));
      const css = d.match(/styles\.css\?v=([^"]+)/);
      console.log("css v:", css ? css[1] : "?");
      const auth = d.match(/auth-ui\.js\?v=([^"]+)/);
      console.log("auth-ui v:", auth ? auth[1] : "?");
    });
  })
  .on("error", (e) => console.log("ERR:", e.message));
