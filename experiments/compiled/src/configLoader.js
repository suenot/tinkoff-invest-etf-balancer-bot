"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigLoader = exports.getTestConfigLoader = exports.configLoader = void 0;
const fs_1 = require("fs");
const path_1 = require("path");
class ConfigLoader {
    constructor(configPath) {
        this.config = null;
        // Поддержка разных конфигов: тестовый или основной
        this.configPath = configPath ||
            (process.env.NODE_ENV === 'test' ? 'CONFIG.test.json' : 'CONFIG.json');
    }
    static getInstance(configPath) {
        if (!ConfigLoader.instance) {
            ConfigLoader.instance = new ConfigLoader(configPath);
        }
        return ConfigLoader.instance;
    }
    static resetInstance() {
        ConfigLoader.instance = null;
    }
    loadConfig() {
        if (this.config) {
            return this.config;
        }
        try {
            const configPath = (0, path_1.join)(process.cwd(), this.configPath);
            const configData = (0, fs_1.readFileSync)(configPath, 'utf8');
            this.config = JSON.parse(configData);
            // Configuration validation
            this.validateConfig(this.config);
            return this.config;
        }
        catch (error) {
            throw new Error(`Configuration loading error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    getAccountById(accountId) {
        const config = this.loadConfig();
        return config.accounts.find(account => account.id === accountId);
    }
    getAccountByToken(token) {
        const config = this.loadConfig();
        return config.accounts.find(account => account.t_invest_token === token);
    }
    getAllAccounts() {
        const config = this.loadConfig();
        return config.accounts;
    }
    getAccountToken(accountId) {
        const account = this.getAccountById(accountId);
        if (!account)
            return undefined;
        const tokenValue = account.t_invest_token;
        // If token is in ${VARIABLE_NAME} format, extract from environment variables
        if (tokenValue.startsWith('${') && tokenValue.endsWith('}')) {
            const envVarName = tokenValue.slice(2, -1);
            return process.env[envVarName];
        }
        // Otherwise return token as is (directly specified)
        return tokenValue;
    }
    getAccountAccountId(accountId) {
        const account = this.getAccountById(accountId);
        return account?.account_id;
    }
    getRawTokenValue(accountId) {
        const account = this.getAccountById(accountId);
        return account?.t_invest_token;
    }
    isTokenFromEnv(accountId) {
        const account = this.getAccountById(accountId);
        if (!account)
            return false;
        const tokenValue = account.t_invest_token;
        return tokenValue.startsWith('${') && tokenValue.endsWith('}');
    }
    validateConfig(config) {
        if (!config.accounts || !Array.isArray(config.accounts)) {
            throw new Error('Configuration must contain accounts array');
        }
        for (const account of config.accounts) {
            this.validateAccount(account);
        }
        // Validate analysis configuration if present
        if (config.analysis) {
            this.validateAnalysisConfig(config.analysis);
        }
    }
    validateAccount(account) {
        const requiredFields = ['id', 'name', 't_invest_token', 'account_id', 'desired_wallet'];
        for (const field of requiredFields) {
            if (!(field in account)) {
                throw new Error(`Account ${account.id || 'unknown'} must contain field ${field}`);
            }
        }
        if (!account.desired_wallet || Object.keys(account.desired_wallet).length === 0) {
            throw new Error(`Account ${account.id} must contain non-empty desired_wallet`);
        }
        // Validate individual wallet percentages first
        for (const [ticker, percentage] of Object.entries(account.desired_wallet)) {
            if (typeof percentage !== 'number' || isNaN(percentage)) {
                throw new Error(`Invalid percentage for ticker ${ticker}: must be a number`);
            }
            if (!isFinite(percentage) || percentage > Number.MAX_SAFE_INTEGER) {
                throw new Error(`Invalid percentage for ticker ${ticker}: value too large`);
            }
            if (percentage < 0 || percentage > 100) {
                throw new Error(`Invalid percentage for ticker ${ticker}: must be between 0 and 100`);
            }
        }
        // Check that sum of weights is reasonable (between 50% and 150%)
        // The balancer will normalize these weights to 100% automatically
        const totalWeight = Object.values(account.desired_wallet).reduce((sum, weight) => sum + weight, 0);
        if (totalWeight < 50 || totalWeight > 150) {
            throw new Error(`Wallet validation failed: sum of weights for account ${account.id} equals ${totalWeight}%, expected between 50% and 150%`);
        }
        // Validate min_profit_percent_for_close_position configuration if present
        if (account.min_profit_percent_for_close_position !== undefined) {
            this.validateMinProfitPercentForClosePosition(account.min_profit_percent_for_close_position, account.id);
        }
        // Set default exchange_closure_behavior if not provided (backward compatibility)
        if (!account.exchange_closure_behavior) {
            account.exchange_closure_behavior = {
                mode: 'skip_iteration',
                update_iteration_result: false
            };
            console.log(`Info: Using default exchange closure behavior (skip_iteration) for account ${account.id}`);
        }
        else {
            // Validate exchange_closure_behavior configuration
            this.validateExchangeClosureBehavior(account.exchange_closure_behavior, account.id);
        }
        // Validate buy_requires_total_marginal_sell configuration if present
        if (account.buy_requires_total_marginal_sell) {
            this.validateBuyRequiresTotalMarginalSell(account.buy_requires_total_marginal_sell, account);
        }
        // Validate and set diff configuration defaults
        this.validateDiffConfiguration(account);
    }
    async updateAccountConfig(accountId, updates) {
        const config = this.loadConfig();
        const accountIndex = config.accounts.findIndex(account => account.id === accountId);
        if (accountIndex === -1) {
            throw new Error(`Account with ID '${accountId}' not found`);
        }
        // Create updated account config
        const updatedAccount = { ...config.accounts[accountIndex], ...updates };
        // Validate the updated account
        this.validateAccount(updatedAccount);
        // Update the config
        config.accounts[accountIndex] = updatedAccount;
        // Save to file
        await this.saveConfig(config);
        // Update cached config
        this.config = config;
    }
    async updateConfig(config) {
        // Validate the entire config
        this.validateConfig(config);
        // Save to file
        await this.saveConfig(config);
        // Update cached config
        this.config = config;
    }
    async saveConfig(config) {
        try {
            const configPath = (0, path_1.join)(process.cwd(), 'CONFIG.json');
            const configData = JSON.stringify(config, null, 2);
            (0, fs_1.writeFileSync)(configPath, configData, 'utf8');
        }
        catch (error) {
            throw new Error(`Failed to save configuration: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    validateExchangeClosureBehavior(behavior, accountId) {
        const validModes = ['skip_iteration', 'force_orders', 'dry_run'];
        if (!behavior.mode || !validModes.includes(behavior.mode)) {
            throw new Error(`Account ${accountId}: exchange_closure_behavior.mode must be one of: ${validModes.join(', ')}. ` +
                `Got: ${behavior.mode}`);
        }
        if (typeof behavior.update_iteration_result !== 'boolean') {
            throw new Error(`Account ${accountId}: exchange_closure_behavior.update_iteration_result must be a boolean. ` +
                `Got: ${typeof behavior.update_iteration_result}`);
        }
    }
    validateBuyRequiresTotalMarginalSell(config, account) {
        // Validate enabled field
        if (typeof config.enabled !== 'boolean') {
            throw new Error(`Account ${account.id}: buy_requires_total_marginal_sell.enabled must be a boolean. Got: ${typeof config.enabled}`);
        }
        // Validate instruments field
        if (!Array.isArray(config.instruments)) {
            throw new Error(`Account ${account.id}: buy_requires_total_marginal_sell.instruments must be an array. Got: ${typeof config.instruments}`);
        }
        // Validate that all instruments are strings
        for (const instrument of config.instruments) {
            if (typeof instrument !== 'string') {
                throw new Error(`Account ${account.id}: buy_requires_total_marginal_sell.instruments must contain only strings. Found: ${typeof instrument}`);
            }
        }
        // Note: instruments in buy_requires_total_marginal_sell represent assets that don't support margin trading
        // They don't need to be in desired_wallet - this is just a list of non-margin instruments on the exchange
        // Validate allow_to_sell_others_positions_to_buy_non_marginal_positions
        if (!config.allow_to_sell_others_positions_to_buy_non_marginal_positions) {
            throw new Error(`Account ${account.id}: buy_requires_total_marginal_sell.allow_to_sell_others_positions_to_buy_non_marginal_positions is required`);
        }
        if (!config.allow_to_sell_others_positions_to_buy_non_marginal_positions.mode) {
            throw new Error(`Account ${account.id}: buy_requires_total_marginal_sell.allow_to_sell_others_positions_to_buy_non_marginal_positions.mode is required`);
        }
        const validModes = ['only_positive_positions_sell', 'equal_in_percents', 'none'];
        if (!validModes.includes(config.allow_to_sell_others_positions_to_buy_non_marginal_positions.mode)) {
            throw new Error(`Account ${account.id}: buy_requires_total_marginal_sell.allow_to_sell_others_positions_to_buy_non_marginal_positions.mode must be one of: ${validModes.join(', ')}. Got: ${config.allow_to_sell_others_positions_to_buy_non_marginal_positions.mode}`);
        }
        // Validate min_buy_rebalance_percent
        if (typeof config.min_buy_rebalance_percent !== 'number') {
            throw new Error(`Account ${account.id}: buy_requires_total_marginal_sell.min_buy_rebalance_percent must be a number. Got: ${typeof config.min_buy_rebalance_percent}`);
        }
        if (config.min_buy_rebalance_percent < 0 || config.min_buy_rebalance_percent > 100) {
            throw new Error(`Account ${account.id}: buy_requires_total_marginal_sell.min_buy_rebalance_percent must be between 0 and 100. Got: ${config.min_buy_rebalance_percent}`);
        }
    }
    validateMinProfitPercentForClosePosition(minProfitPercent, accountId) {
        // Validate that it's a number
        if (typeof minProfitPercent !== 'number') {
            throw new Error(`Account ${accountId}: min_profit_percent_for_close_position must be a number. Got: ${typeof minProfitPercent}`);
        }
        // Validate that it's a finite number
        if (!Number.isFinite(minProfitPercent)) {
            throw new Error(`Account ${accountId}: min_profit_percent_for_close_position must be a finite number. Got: ${minProfitPercent}`);
        }
        // Allow negative values (for maximum loss) but set reasonable bounds
        // Minimum: -100% (complete loss), Maximum: 1000% (10x profit)
        if (minProfitPercent < -100 || minProfitPercent > 1000) {
            throw new Error(`Account ${accountId}: min_profit_percent_for_close_position must be between -100 and 1000. Got: ${minProfitPercent}`);
        }
    }
    validateDiffConfiguration(account) {
        // Set default values if not provided
        if (!account.diff) {
            account.diff = 'off';
        }
        if (account.diff_multiplier === undefined) {
            account.diff_multiplier = 0;
        }
        // Validate diff mode
        const validDiffModes = ['off', 'iteration', 'day'];
        if (!validDiffModes.includes(account.diff)) {
            throw new Error(`Account ${account.id}: diff must be one of: ${validDiffModes.join(', ')}. ` +
                `Got: ${account.diff}`);
        }
        // Validate diff_multiplier
        if (typeof account.diff_multiplier !== 'number') {
            throw new Error(`Account ${account.id}: diff_multiplier must be a number. ` +
                `Got: ${typeof account.diff_multiplier}`);
        }
        if (!Number.isFinite(account.diff_multiplier)) {
            throw new Error(`Account ${account.id}: diff_multiplier must be a finite number. ` +
                `Got: ${account.diff_multiplier}`);
        }
        if (account.diff_multiplier < 0 || account.diff_multiplier > 100) {
            throw new Error(`Account ${account.id}: diff_multiplier must be between 0 and 100. ` +
                `Got: ${account.diff_multiplier}`);
        }
        // Log warning if diff_multiplier is set but diff is 'off'
        if (account.diff === 'off' && account.diff_multiplier > 0) {
            console.log(`Warning: Account ${account.id} has diff_multiplier set to ${account.diff_multiplier} ` +
                `but diff is 'off'. The multiplier will have no effect.`);
        }
    }
    validateAnalysisConfig(analysis) {
        // Validate openrouter configuration
        if (!analysis.openrouter) {
            throw new Error('Analysis configuration must contain openrouter section');
        }
        this.validateOpenRouterConfig(analysis.openrouter);
    }
    validateOpenRouterConfig(openrouter) {
        // Validate enabled field - required
        if (typeof openrouter.enabled !== 'boolean') {
            throw new Error('analysis.openrouter.enabled must be a boolean. Got: ' + typeof openrouter.enabled);
        }
        // Validate optional model field
        if (openrouter.model !== undefined && typeof openrouter.model !== 'string') {
            throw new Error('analysis.openrouter.model must be a string. Got: ' + typeof openrouter.model);
        }
        // Validate optional temperature field
        if (openrouter.temperature !== undefined) {
            if (typeof openrouter.temperature !== 'number') {
                throw new Error('analysis.openrouter.temperature must be a number. Got: ' + typeof openrouter.temperature);
            }
            if (!Number.isFinite(openrouter.temperature)) {
                throw new Error('analysis.openrouter.temperature must be a finite number. Got: ' + openrouter.temperature);
            }
            if (openrouter.temperature < 0.0 || openrouter.temperature > 2.0) {
                throw new Error('analysis.openrouter.temperature must be between 0.0 and 2.0. Got: ' + openrouter.temperature);
            }
        }
    }
}
exports.ConfigLoader = ConfigLoader;
// Export singleton for convenience with test support
exports.configLoader = ConfigLoader.getInstance();
const getTestConfigLoader = () => ConfigLoader.getInstance('CONFIG.test.json');
exports.getTestConfigLoader = getTestConfigLoader;
exports.default = ConfigLoader;
