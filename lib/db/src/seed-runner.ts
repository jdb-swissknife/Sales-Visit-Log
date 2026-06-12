import { seedBusinesses } from "./seed";

seedBusinesses((msg) => process.stdout.write(msg + "\n"))
  .then(() => process.exit(0))
  .catch((err) => {
    process.stderr.write(String(err) + "\n");
    process.exit(1);
  });
