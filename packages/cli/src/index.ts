const formaCliVersion = "0.1.0";

export function runCli(argv = process.argv.slice(2)): void {
  const [command] = argv;

  if (command === "--help" || command === "-h" || command === "help") {
    console.log("Usage: forma [version|--help]");
    return;
  }

  if (command === "version" || command === "--version" || command === "-v") {
    console.log(`forma ${formaCliVersion}`);
    return;
  }

  console.log(`forma ${formaCliVersion}`);
}
