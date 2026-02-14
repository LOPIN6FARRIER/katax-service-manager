# Katax Service Manager - Copilot Instructions

## Project Overview
This is a TypeScript npm package that provides a runtime service container (singleton pattern) for Node.js applications. It manages shared resources like configuration, logging, database connection pools, and WebSocket services.

## Architecture
- **Singleton Pattern**: Single instance across the application
- **Service Container**: Manages lifecycle of config, logger, database, and websocket services
- **Fail-Fast**: Application must initialize services before starting
- **TypeScript First**: Strict mode enabled for maximum type safety

## Key Files
- `src/katax.ts`: Main singleton class that orchestrates all services
- `src/types.ts`: TypeScript interfaces and type definitions
- `src/services/`: Individual service implementations
  - `config.service.ts`: Environment and config management
  - `logger.service.ts`: Pino-based structured logging
  - `database.service.ts`: Database connection pool wrapper (PostgreSQL/MySQL/MongoDB)
  - `websocket.service.ts`: Socket.IO for real-time communication

## Development Guidelines

### Code Style
- Use strict TypeScript with all strict options enabled
- Prefer explicit types over `any`
- Use async/await instead of callbacks
- Follow single responsibility principle

### Testing
- Unit tests with Vitest
- Test services in isolation
- Mock external dependencies

### Building
```bash
npm run build        # Compile TypeScript
npm run typecheck    # Type checking only
npm run lint         # ESLint
npm run format       # Prettier
```

### Best Practices
1. All services are optional except config and logger
2. Database drivers (pg, mysql2, mongodb) are peer dependencies - user installs what they need
3. Use `@ts-expect-error` for optional peer dependency imports
4. Always provide clear error messages
5. Support graceful shutdown

## Usage Pattern
```typescript
import { Katax } from 'katax-service-manager';

// Initialize once
await Katax.getInstance().init({ /* config */ });

// Use anywhere
const katax = Katax.getInstance();
katax.logger.info('Hello');
const data = await katax.db.query('SELECT * FROM users');
```

## Future Enhancements
- [ ] Metrics service (Prometheus)
- [ ] Cache service (Redis)
- [ ] Queue service (Bull/BullMQ)
- [ ] Health checks
- [ ] Circuit breaker pattern
