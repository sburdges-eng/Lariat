#include <gtest/gtest.h>

#include <cstdint>
#include <string>

#include "apple/graphics/engine.hpp"
#include "apple/graphics/intents_bridge.hpp"

namespace {

using AppleGraphics::AppIntentsBridge;
using AppleGraphics::AppleUnifiedEngine;
using AppleGraphics::AssistantSchema;
using AppleGraphics::DispatchResult;
using AppleGraphics::ParamMap;
using AppleGraphics::ParamSpec;
using AppleGraphics::ParamType;
using AppleGraphics::ParamValue;

// A schema with one required String param (with maxLength + allowedValues) and
// one optional Int param (with min/max). The handler echoes the String and
// reports a target id.
AssistantSchema highlightSchema() {
    AssistantSchema s;
    s.name = "highlightTable";
    s.description = "Highlight a table on the floor plan";
    ParamSpec name;
    name.name = "table";
    name.type = ParamType::String;
    name.required = true;
    name.maxLength = 8;
    name.allowedValues = {"T1", "T2", "T3"};
    ParamSpec seats;
    seats.name = "seats";
    seats.type = ParamType::Int;
    seats.required = false;
    seats.minValue = 1.0;
    seats.maxValue = 12.0;
    s.params = {name, seats};
    return s;
}

AppleGraphics::IntentHandler highlightHandler(bool* ran) {
    return [ran](const ParamMap& params)
               -> std::expected<DispatchResult, std::string> {
        if (ran != nullptr) {
            *ran = true;
        }
        const auto& table = std::get<std::string>(params.at("table"));
        return DispatchResult{"highlighted " + table, table};
    };
}

TEST(AppIntents, RegisterAndDispatchHappyPath) {
    AppIntentsBridge bridge;
    bool ran = false;
    ASSERT_TRUE(bridge.registerSchema(highlightSchema(), highlightHandler(&ran))
                    .has_value());

    ParamMap params{{"table", std::string{"T2"}}, {"seats", std::int64_t{4}}};
    auto r = bridge.dispatch("highlightTable", params);
    ASSERT_TRUE(r.has_value());
    EXPECT_TRUE(ran);
    EXPECT_EQ(r->message, "highlighted T2");
    ASSERT_TRUE(r->targetId.has_value());
    EXPECT_EQ(*r->targetId, "T2");
}

TEST(AppIntents, DuplicateAndEmptyNameRejected) {
    AppIntentsBridge bridge;
    ASSERT_TRUE(bridge.registerSchema(highlightSchema(), highlightHandler(nullptr))
                    .has_value());
    EXPECT_FALSE(bridge.registerSchema(highlightSchema(), highlightHandler(nullptr))
                     .has_value());

    AssistantSchema empty;
    empty.name = "";
    EXPECT_FALSE(
        bridge.registerSchema(empty, highlightHandler(nullptr)).has_value());
}

TEST(AppIntents, UnknownIntentRejected) {
    AppIntentsBridge bridge;
    auto r = bridge.dispatch("nope", ParamMap{});
    EXPECT_FALSE(r.has_value());
}

TEST(AppIntents, MissingRequiredParamRejectedOptionalOmittedOk) {
    AppIntentsBridge bridge;
    ASSERT_TRUE(bridge.registerSchema(highlightSchema(), highlightHandler(nullptr))
                    .has_value());

    // Missing the required "table".
    EXPECT_FALSE(
        bridge.dispatch("highlightTable", ParamMap{{"seats", std::int64_t{2}}})
            .has_value());

    // Optional "seats" omitted is fine.
    auto r = bridge.dispatch("highlightTable",
                             ParamMap{{"table", std::string{"T1"}}});
    EXPECT_TRUE(r.has_value());
}

TEST(AppIntents, TypeMismatchRejected) {
    AppIntentsBridge bridge;
    ASSERT_TRUE(bridge.registerSchema(highlightSchema(), highlightHandler(nullptr))
                    .has_value());

    // "table" is a String param, but an Int is supplied.
    auto r = bridge.dispatch("highlightTable",
                             ParamMap{{"table", std::int64_t{7}}});
    EXPECT_FALSE(r.has_value());
}

TEST(AppIntents, StringConstraintsEnforced) {
    AppIntentsBridge bridge;
    ASSERT_TRUE(bridge.registerSchema(highlightSchema(), highlightHandler(nullptr))
                    .has_value());

    // maxLength = 8 exceeded.
    EXPECT_FALSE(
        bridge
            .dispatch("highlightTable",
                      ParamMap{{"table", std::string{"thisiswaytoolong"}}})
            .has_value());

    // allowedValues = {T1,T2,T3}; "T9" is not allowed (and within maxLength).
    EXPECT_FALSE(bridge
                     .dispatch("highlightTable",
                               ParamMap{{"table", std::string{"T9"}}})
                     .has_value());
}

TEST(AppIntents, NumericMinMaxEnforced) {
    AppIntentsBridge bridge;
    ASSERT_TRUE(bridge.registerSchema(highlightSchema(), highlightHandler(nullptr))
                    .has_value());

    // seats min = 1: 0 is below.
    EXPECT_FALSE(bridge
                     .dispatch("highlightTable",
                               ParamMap{{"table", std::string{"T1"}},
                                        {"seats", std::int64_t{0}}})
                     .has_value());

    // seats max = 12: 13 is above.
    EXPECT_FALSE(bridge
                     .dispatch("highlightTable",
                               ParamMap{{"table", std::string{"T1"}},
                                        {"seats", std::int64_t{13}}})
                     .has_value());
}

TEST(AppIntents, UnrecognizedExtraParamRejected) {
    AppIntentsBridge bridge;
    ASSERT_TRUE(bridge.registerSchema(highlightSchema(), highlightHandler(nullptr))
                    .has_value());

    auto r = bridge.dispatch("highlightTable",
                             ParamMap{{"table", std::string{"T1"}},
                                      {"bogus", std::string{"x"}}});
    EXPECT_FALSE(r.has_value());
}

TEST(AppIntents, SuccessfulDispatchAutoDonatesAndManualDonateAppends) {
    AppIntentsBridge bridge;
    ASSERT_TRUE(bridge.registerSchema(highlightSchema(), highlightHandler(nullptr))
                    .has_value());

    EXPECT_TRUE(bridge.donatedInteractions().empty());
    ASSERT_TRUE(bridge
                    .dispatch("highlightTable",
                              ParamMap{{"table", std::string{"T3"}}})
                    .has_value());
    EXPECT_EQ(bridge.donatedInteractions().size(), 1u);

    // A failed dispatch must not donate.
    (void)bridge.dispatch("highlightTable", ParamMap{});
    EXPECT_EQ(bridge.donatedInteractions().size(), 1u);

    bridge.donateInteraction("manual entry");
    EXPECT_EQ(bridge.donatedInteractions().size(), 2u);
    EXPECT_EQ(bridge.donatedInteractions().back(), "manual entry");
}

TEST(AppIntents, IntrospectionHelpers) {
    AppIntentsBridge bridge;
    EXPECT_EQ(bridge.schemaFor("highlightTable"), nullptr);
    ASSERT_TRUE(bridge.registerSchema(highlightSchema(), highlightHandler(nullptr))
                    .has_value());

    const auto names = bridge.registeredIntents();
    ASSERT_EQ(names.size(), 1u);
    EXPECT_EQ(names.front(), "highlightTable");

    const AssistantSchema* s = bridge.schemaFor("highlightTable");
    ASSERT_NE(s, nullptr);
    EXPECT_EQ(s->name, "highlightTable");
    EXPECT_EQ(s->params.size(), 2u);
}

TEST(AppIntents, EngineExposesUsableBridge) {
    AppleUnifiedEngine engine;
    bool ran = false;
    ASSERT_TRUE(engine.intents()
                    .registerSchema(highlightSchema(), highlightHandler(&ran))
                    .has_value());

    auto r = engine.intents().dispatch(
        "highlightTable", ParamMap{{"table", std::string{"T1"}}});
    ASSERT_TRUE(r.has_value());
    EXPECT_TRUE(ran);
    EXPECT_EQ(r->message, "highlighted T1");
    EXPECT_EQ(engine.intents().donatedInteractions().size(), 1u);
}

} // namespace
