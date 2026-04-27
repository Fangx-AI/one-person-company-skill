async function main() {
  const response = await fetch("http://localhost:3000/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      systemPrompt: "You are a concise assistant.",
      messages: [
        {
          role: "user",
          content: "Reply with exactly: connected",
        },
      ],
      context: {},
    }),
  });

  const text = await response.text();
  console.log(`STATUS ${response.status}`);
  console.log(text);

  if (!response.ok) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
