import { runSmokeTests } from "./smoke";

export async function run(): Promise<void> {
  await runSmokeTests();
}
