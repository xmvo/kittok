import { LoadConfig } from '../src/config.mjs';
import { Database, Migrate } from '../src/db.mjs';
const Pool = Database(LoadConfig().DatabaseUrl);
try { await Migrate(Pool); console.log('Database is current.'); }
finally { await Pool.end(); }
