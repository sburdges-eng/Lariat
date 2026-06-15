#include "apple/graphics/intents_bridge.hpp"

#include <iostream>

namespace AppleGraphics {

namespace {

// The variant alternative index that a given ParamType must occupy in a
// ParamValue. Keep in sync with the ParamValue alias declaration order:
//   index 0 = std::string, 1 = std::int64_t, 2 = double, 3 = bool.
constexpr std::size_t variantIndexFor(ParamType type) {
    switch (type) {
        case ParamType::String:
            return 0;
        case ParamType::Int:
            return 1;
        case ParamType::Double:
            return 2;
        case ParamType::Bool:
            return 3;
    }
    return 0; // unreachable; all enumerators handled
}

const char* nameFor(ParamType type) {
    switch (type) {
        case ParamType::String:
            return "String";
        case ParamType::Int:
            return "Int";
        case ParamType::Double:
            return "Double";
        case ParamType::Bool:
            return "Bool";
    }
    return "Unknown";
}

// Numeric value of an Int/Double ParamValue, as a double, for min/max checks.
double numericValue(const ParamValue& value) {
    if (std::holds_alternative<std::int64_t>(value)) {
        return static_cast<double>(std::get<std::int64_t>(value));
    }
    return std::get<double>(value);
}

// Validates a single present param against its spec. Returns an error string on
// failure, std::nullopt on success.
std::optional<std::string> validateParam(const ParamSpec& spec,
                                         const ParamValue& value) {
    if (value.index() != variantIndexFor(spec.type)) {
        return "parameter '" + spec.name + "' expected type " +
               nameFor(spec.type);
    }

    if (spec.type == ParamType::String) {
        const std::string& s = std::get<std::string>(value);
        if (spec.maxLength.has_value() && s.size() > *spec.maxLength) {
            return "parameter '" + spec.name + "' exceeds maxLength";
        }
        if (!spec.allowedValues.empty()) {
            bool allowed = false;
            for (const std::string& candidate : spec.allowedValues) {
                if (candidate == s) {
                    allowed = true;
                    break;
                }
            }
            if (!allowed) {
                return "parameter '" + spec.name + "' value not in allowedValues";
            }
        }
        return std::nullopt;
    }

    if (spec.type == ParamType::Int || spec.type == ParamType::Double) {
        const double n = numericValue(value);
        if (spec.minValue.has_value() && n < *spec.minValue) {
            return "parameter '" + spec.name + "' below minValue";
        }
        if (spec.maxValue.has_value() && n > *spec.maxValue) {
            return "parameter '" + spec.name + "' above maxValue";
        }
    }

    return std::nullopt;
}

} // namespace

std::expected<void, std::string> AppIntentsBridge::registerSchema(
    AssistantSchema schema, IntentHandler handler) {
    if (schema.name.empty()) {
        return std::unexpected("registerSchema: intent name must not be empty");
    }
    if (intents_.contains(schema.name)) {
        return std::unexpected("registerSchema: duplicate intent name: " +
                               schema.name);
    }
    const std::string name = schema.name;
    intents_.emplace(name, Entry{std::move(schema), std::move(handler)});
    return {};
}

std::expected<DispatchResult, std::string> AppIntentsBridge::dispatch(
    const std::string& intentName, const ParamMap& params) {
    auto it = intents_.find(intentName);
    if (it == intents_.end()) {
        return std::unexpected("dispatch: unknown intent: " + intentName);
    }
    const AssistantSchema& schema = it->second.schema;

    // (1) Reject any param not declared by the schema.
    for (const auto& [name, value] : params) {
        bool declared = false;
        for (const ParamSpec& spec : schema.params) {
            if (spec.name == name) {
                declared = true;
                break;
            }
        }
        if (!declared) {
            return std::unexpected("dispatch: unrecognized parameter " + name);
        }
    }

    // (2) Each required param must be present; each present param must validate.
    for (const ParamSpec& spec : schema.params) {
        auto pIt = params.find(spec.name);
        if (pIt == params.end()) {
            if (spec.required) {
                return std::unexpected("dispatch: missing required parameter '" +
                                       spec.name + "'");
            }
            continue; // optional and omitted
        }
        if (auto err = validateParam(spec, pIt->second); err.has_value()) {
            return std::unexpected("dispatch: " + *err);
        }
    }

    // (3) Params are valid; run the handler.
    std::expected<DispatchResult, std::string> result =
        it->second.handler(params);
    if (!result.has_value()) {
        return result;
    }

    // Donate a one-line description of the successful interaction so the
    // simulated assistant index reflects usage.
    std::string donation = "dispatched '" + intentName + "': " +
                           result->message;
    if (result->targetId.has_value()) {
        donation += " (target=" + *result->targetId + ")";
    }
    donateInteraction(donation);

    return result;
}

void AppIntentsBridge::donateInteraction(const std::string& description) {
    donations_.push_back(description);
    std::cout << "[AppIntents] donate: " << description << '\n';
}

std::vector<std::string> AppIntentsBridge::registeredIntents() const {
    std::vector<std::string> names;
    names.reserve(intents_.size());
    for (const auto& [name, entry] : intents_) {
        names.push_back(name);
    }
    return names;
}

const AssistantSchema* AppIntentsBridge::schemaFor(
    const std::string& name) const {
    auto it = intents_.find(name);
    if (it == intents_.end()) {
        return nullptr;
    }
    return &it->second.schema;
}

} // namespace AppleGraphics
