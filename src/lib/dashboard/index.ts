// Importing this barrel registers every built-in dashboard module via
// each module file's side effects. The dashboard view calls
// listDashboardModules() to enumerate them at render time.

import './algorand-module';
import './nfdominter-module';
import './chain-wallets-module';
import './ario-module';
import './bankon-module';
import './marketspace-module';

export {
  listDashboardModules,
  registerDashboardModule,
  type DashboardContext,
  type DashboardModule,
} from '../dashboard-modules';
