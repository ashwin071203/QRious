import { run } from "../../../scripts/migrate";

export default async function setup() {
  await run(process.env.TEST_DATABASE_URL ?? "postgres://qrious:qrious_dev_password@localhost:5432/qrious_test");
}
