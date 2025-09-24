# Installation and Setup

<cite>
**Referenced Files in This Document**   
- [CONFIG.example.json](file://CONFIG.example.json)
- [debug-configloader.ts](file://debug-configloader.ts)
- [README.config.md](file://README.config.md)
- [README.bunjs.md](file://README.bunjs.md)
- [package.json](file://package.json)
- [src/configLoader.ts](file://src/configLoader.ts)
</cite>

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Runtime Installation: Node.js vs Bun](#runtime-installation-nodejs-vs-bun)
3. [Repository Cloning and Dependency Installation](#repository-cloning-and-dependency-installation)
4. [Tinkoff API Token Generation](#tinkoff-api-token-generation)
5. [Configuration File Setup](#configuration-file-setup)
6. [Environment Variable Management](#environment-variable-management)
7. [Configuration Validation and Debugging](#configuration-validation-and-debugging)
8. [Platform-Specific Considerations](#platform-specific-considerations)
9. [Common Pitfalls and Troubleshooting](#common-pitfalls-and-troubleshooting)

## Prerequisites

Before installing the Tinkoff Invest ETF Balancer Bot, ensure your system meets the following prerequisites:

- **Operating System**: Compatible with macOS, Linux, or Windows (via WSL recommended)
- **JavaScript Runtime**: Either Bun 1.0+ or Node.js 18+
- **Package Manager**: bun or npm depending on runtime choice
- **Text Editor or IDE**: For editing configuration files
- **Terminal/Command Line Access**: For executing installation commands
- **Tinkoff Invest Account**: Active brokerage account with API access enabled

The application is designed to work primarily with Bun for optimal performance, but maintains compatibility with Node.js environments.

**Section sources**
- [README.bunjs.md](file://README.bunjs.md#L1-L222)
- [package.json](file://package.json#L1-L92)

## Runtime Installation: Node.js vs Bun

### Bun Installation (Recommended)

Bun is the preferred runtime due to its superior performance and native TypeScript support. To install Bun:

```bash
# macOS/Linux
curl -fsSL https://bun.sh/install | bash

# Add to PATH (add to ~/.zshrc, ~/.bashrc, or similar)
export PATH="$HOME/.bun/bin:$PATH"
```

Verify installation:
```bash
bun --version
```

Bun offers significant advantages over traditional Node.js setups:
- Native TypeScript execution without transpilation
- Faster startup times (~107ms build time)
- Built-in bundler, test runner, and package manager
- ES modules by default
- Smaller memory footprint

### Node.js Installation (Alternative)

If using Node.js instead of Bun:

1. Install Node.js version 18 or higher from [nodejs.org](https://nodejs.org)
2. Verify installation:
   ```bash
   node --version
   npm --version
   ```

While functional, Node.js requires additional tooling like ts-node for TypeScript execution, resulting in slower performance compared to Bun's native implementation.

**Section sources**
- [README.bunjs.md](file://README.bunjs.md#L1-L222)
- [package.json](file://package.json#L1-L92)

## Repository Cloning and Dependency Installation

Clone the repository and install dependencies using your chosen runtime:

```bash
# Clone the repository
git clone https://github.com/suenot/deep-tinkoff-invest-api.git
cd deep-tinkoff-invest-api

# Install dependencies with Bun (recommended)
bun install

# OR install dependencies with npm
npm install
```

The `package.json` file specifies Bun as the required engine, ensuring compatibility:
```json
"engines": {
  "bun": ">=1.0.0"
}
```

After installation, verify the setup by running a basic command:
```bash
# Test configuration management
bun run config help

# Or with npm
npm run config help
```

This confirms that both the runtime and dependencies are properly installed and accessible.

**Section sources**
- [package.json](file://package.json#L1-L92)
- [README.bunjs.md](file://README.bunjs.md#L1-L222)

## Tinkoff API Token Generation

To generate your Tinkoff API token:

1. Log in to your Tinkoff Invest account via the mobile app or website
2. Navigate to **Profile Settings** → **API Access**
3. Click **Create New Token**
4. Assign a descriptive name (e.g., "BalancerBotProduction")
5. Select appropriate permissions:
   - **Read-only access** for monitoring
   - **Trade operations** for portfolio rebalancing
   - **Account information** for balance checks
6. Copy the generated token immediately (it will not be shown again)

Store tokens securely using environment variables rather than hardcoding them. Each account in the configuration should reference an environment variable such as `T_INVEST_TOKEN_1`, `T_INVEST_TOKEN_2`, etc.

Ensure tokens have sufficient permissions for intended operations. Insufficient permissions will result in authentication errors during bot execution.

**Section sources**
- [README.config.md](file://README.config.md#L1-L200)
- [CONFIG.example.json](file://CONFIG.example.json#L1-L52)

## Configuration File Setup

Create your configuration file by copying the example:

```bash
cp CONFIG.example.json CONFIG.json
```

Edit `CONFIG.json` to configure your accounts. The structure includes:

```json
{
  "accounts": [
    {
      "id": "account_1",
      "name": "Main Brokerage Account",
      "t_invest_token": "${T_INVEST_TOKEN_1}",
      "account_id": "BROKER",
      "desired_wallet": {
        "TGLD": 8.33,
        "TRUR": 8.33,
        "TRND": 8.33
      },
      "desired_mode": "manual",
      "balance_interval": 3600000,
      "margin_trading": {
        "enabled": false
      }
    }
  ]
}
```

### Required Fields
- `id`: Unique identifier for the account
- `name`: Human-readable account name
- `t_invest_token`: Environment variable containing the API token
- `account_id`: Account type (BROKER, ISS) or specific ID
- `desired_wallet`: Target allocation percentages for ETFs

### Validation Rules
- Wallet percentages must be numbers between 0-100
- Sum of all weights should be between 50% and 150% (automatically normalized)
- All required fields must be present
- JSON syntax must be valid

Use the validation command to check configuration integrity:
```bash
bun run config validate
```

**Section sources**
- [CONFIG.example.json](file://CONFIG.example.json#L1-L52)
- [README.config.md](file://README.config.md#L1-L200)
- [src/configLoader.ts](file://src/configLoader.ts#L1-L345)

## Environment Variable Management

Create a `.env` file to store sensitive credentials securely:

```bash
# .env
T_INVEST_TOKEN_1=your_actual_token_here
T_INVEST_TOKEN_2=another_token_here
OPENROUTER_API_KEY=your_openrouter_key
```

The configuration loader automatically resolves environment variables when token values follow the `${VARIABLE_NAME}` format. This approach ensures credentials remain separate from version-controlled configuration files.

Add `.env` to your `.gitignore` to prevent accidental commits:
```
.env
*.env.local
```

Load environment variables in your application using the `dotenv` package, which is included as a dependency. The system will automatically load variables from the `.env` file at runtime.

For production deployments, consider using platform-specific secret management solutions instead of `.env` files.

**Section sources**
- [README.config.md](file://README.config.md#L1-L200)
- [package.json](file://package.json#L1-L92)

## Configuration Validation and Debugging

Validate your configuration using built-in tools:

```bash
# Validate configuration structure
bun run config validate

# List available accounts
bun run config list

# Show details for specific account
bun run config show account_1
```

Use the debug-configloader script to inspect configuration loading behavior:

```bash
bun run debug-configloader.ts
```

This outputs:
```
ConfigLoader type: function
ConfigLoader methods: constructor,loadConfig,getAccountById,getAccountToken...
Has loadConfig: function
Has getAccountById: function
```

The `configLoader` singleton provides programmatic access to configuration data:

```typescript
import { configLoader } from './src/configLoader';

try {
  const config = configLoader.loadConfig();
  console.log(`Loaded ${config.accounts.length} accounts`);
} catch (error) {
  console.error('Configuration error:', error.message);
}
```

Validation occurs automatically during loading, checking for:
- Required fields presence
- Data type correctness
- Percentage value ranges
- Logical consistency between settings

**Section sources**
- [debug-configloader.ts](file://debug-configloader.ts#L1-L8)
- [src/configLoader.ts](file://src/configLoader.ts#L1-L345)
- [README.config.md](file://README.config.md#L1-L200)

## Platform-Specific Considerations

### macOS and Linux
- Full support for all features
- Direct execution of installation scripts
- Standard Unix permissions apply
- Use standard terminal applications

### Windows
- Recommended to use Windows Subsystem for Linux (WSL)
- If using native Windows:
  - Install Bun via WSL or use Node.js alternative
  - Use Git Bash or PowerShell instead of Command Prompt
  - Ensure line endings are set to LF in text editors
- Some shell commands may require adaptation

### Cross-Platform Notes
- File paths use forward slashes (`/`) consistently
- Environment variable syntax is platform-agnostic
- The application handles path resolution internally
- All scripts assume Unix-style line endings

For CI/CD integration, ensure your pipeline environment matches your development environment, particularly regarding the JavaScript runtime choice.

**Section sources**
- [README.bunjs.md](file://README.bunjs.md#L1-L222)
- [package.json](file://package.json#L1-L92)

## Common Pitfalls and Troubleshooting

### Incorrect Token Permissions
**Symptom**: Authentication failures despite correct token
**Solution**: Regenerate token with appropriate permissions (trade operations, read access)

### Malformed JSON Configuration
**Symptom**: Configuration loading errors
**Solution**: 
- Validate JSON syntax using online validators
- Ensure proper comma placement
- Check for unescaped characters
- Use `bun run config validate` for detailed error messages

### Missing Required Fields
**Symptom**: "Account must contain field X" errors
**Solution**: Verify all required fields are present:
- id, name, t_invest_token, account_id, desired_wallet

### Environment Variables Not Loading
**Symptom**: Token resolution failures
**Solution**:
- Ensure `.env` file exists in project root
- Verify variable names match references in CONFIG.json
- Restart terminal after modifying .env

### Wallet Weight Validation Errors
**Symptom**: "Wallet validation failed: sum of weights equals X%"
**Solution**: Adjust percentages so total is between 50% and 150%

### Module Resolution Issues
**Symptom**: "require is not defined" errors
**Solution**: Use ES modules syntax with imports/exports, not CommonJS require()

Utilize the comprehensive test suite in `src/__tests__` to verify functionality across different scenarios and edge cases.

**Section sources**
- [src/configLoader.ts](file://src/configLoader.ts#L1-L345)
- [README.config.md](file://README.config.md#L1-L200)
- [CONFIG.example.json](file://CONFIG.example.json#L1-L52)