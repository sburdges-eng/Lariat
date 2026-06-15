#pragma once
#include <cstdint>
#include <expected>
#include <functional>
#include <optional>
#include <string>
#include <unordered_map>
#include <variant>
#include <vector>

namespace AppleGraphics {

// AppIntentsBridge — a simulated model of Apple "Assistant Schemas" (App Intents
// / Apple Intelligence). Real App Intents are declared in Swift and surfaced to
// Siri/Spotlight; here we model the same shape in C++ so the engine and its
// constructs can declare intents that an assistant could reason about and
// invoke.
//
// This is a generic, dependency-light dispatcher: it knows nothing about the
// engine. Handlers are std::function closures that capture whatever state they
// need (a scene node id, a pointer to a construct, etc.), so this header pulls
// in no engine includes.
//
// Dispatch is synchronous and not thread-safe by itself: there is intentionally
// no intent queue. The owning engine already serialises mutation behind its own
// mutex, and modelling the App Intents contract (declare schema -> validate
// params -> run handler -> donate interaction) does not require async machinery.

enum class ParamType { String, Int, Double, Bool };

// Order must match ParamType so a ParamValue's index() lines up with the
// declared ParamType for type checking.
using ParamValue = std::variant<std::string, std::int64_t, double, bool>;

// One parameter slot of an AssistantSchema. Validation constraints are optional
// and only applied to the relevant type:
//   - maxLength      : String only
//   - allowedValues  : String only; enum-style allowlist (empty = unconstrained)
//   - minValue/maxValue : Int/Double only
struct ParamSpec {
    std::string name;
    ParamType type;
    bool required = true;
    std::optional<std::size_t> maxLength;
    std::optional<double> minValue;
    std::optional<double> maxValue;
    std::vector<std::string> allowedValues;
};

using ParamMap = std::unordered_map<std::string, ParamValue>;

// The outcome a handler returns on a successful dispatch. `targetId` optionally
// names the scene object the intent acted on (for assistant follow-ups).
struct DispatchResult {
    std::string message;
    std::optional<std::string> targetId;
};

// A declarative intent the assistant can discover and invoke.
struct AssistantSchema {
    std::string name;
    std::string description;
    std::vector<ParamSpec> params;
};

// Invoked once params have been validated against the schema. Returns the
// dispatch result or an error string the bridge surfaces unchanged.
using IntentHandler =
    std::function<std::expected<DispatchResult, std::string>(const ParamMap&)>;

class AppIntentsBridge {
public:
    AppIntentsBridge() = default;

    // Registers a schema + its handler. Errors on an empty intent name or a name
    // that is already registered.
    std::expected<void, std::string> registerSchema(AssistantSchema schema,
                                                     IntentHandler handler);

    // Validates `params` against the named schema, then runs its handler. On a
    // successful handler call, auto-donates a one-line description of the
    // interaction. Errors if the intent is unknown or validation fails.
    [[nodiscard]] std::expected<DispatchResult, std::string> dispatch(
        const std::string& intentName, const ParamMap& params);

    // Appends `description` to the simulated semantic index. Real App Intents
    // call IntentDonationManager / interaction donation so the assistant learns
    // usage patterns; we just record the string.
    void donateInteraction(const std::string& description);

    [[nodiscard]] const std::vector<std::string>& donatedInteractions() const {
        return donations_;
    }

    // Names of all registered intents (introspection / tests).
    [[nodiscard]] std::vector<std::string> registeredIntents() const;

    // The schema for `name`, or nullptr if unregistered. Pointer is valid until
    // the bridge is mutated/destroyed.
    [[nodiscard]] const AssistantSchema* schemaFor(const std::string& name) const;

private:
    struct Entry {
        AssistantSchema schema;
        IntentHandler handler;
    };

    std::unordered_map<std::string, Entry> intents_;
    std::vector<std::string> donations_;
};

} // namespace AppleGraphics
