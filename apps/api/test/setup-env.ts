// Runs in every worker before any module import — points the app at the test database
// and gives it valid JWT secrets so config env-validation passes.
import { E2E_ENV } from './e2e-config';
Object.assign(process.env, E2E_ENV);
