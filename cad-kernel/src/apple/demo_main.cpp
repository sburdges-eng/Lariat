// demo_main.cpp — End-to-end console demo for the Apple Unified Engine (T9).
//
// This is the ONLY translation unit in the apple module with an int main(); it is
// compiled into the standalone `apple_demo` executable (see CMakeLists.txt) and is
// NOT part of the `apple` library or the test binary.
//
// It exercises the whole AppleGraphics / AppleAudio stack strictly through the
// public API, narrating each step to stdout. It must run to completion with no
// crashes and exit 0 (the CMake build is ASan/UBSan instrumented, so a clean exit
// also proves there is no undefined behaviour on the happy path). It doubles as
// usage documentation for the engine and its three constructs.

#include <iostream>
#include <string>

#include "apple/audio/procedural_synth.hpp"
#include "apple/graphics/constructs/floor_plan.hpp"
#include "apple/graphics/constructs/menu_designer.hpp"
#include "apple/graphics/constructs/stage_setup.hpp"
#include "apple/graphics/engine.hpp"

namespace {

using AppleGraphics::AppleUnifiedEngine;
using AppleGraphics::CollabOp;
using AppleGraphics::ParamMap;
using AppleGraphics::PersonaTemplate;
using AppleGraphics::Vec3;
using AppleGraphics::constructs::FloorPlan;
using AppleGraphics::constructs::MenuDesigner;
using AppleGraphics::constructs::StageSetup;

// Prints the message of a successful dispatch or the error string of a failed one.
// Every std::expected returned by the public API is handled this way so nothing is
// silently dropped and the program stays crash-free.
void reportDispatch(const std::string& label,
                    const std::expected<AppleGraphics::DispatchResult, std::string>& r) {
    if (r.has_value()) {
        std::cout << "  [intent] " << label << " -> " << r->message;
        if (r->targetId.has_value()) {
            std::cout << " (target=" << *r->targetId << ")";
        }
        std::cout << "\n";
    } else {
        std::cout << "  [intent] " << label << " FAILED: " << r.error() << "\n";
    }
}

// Narrates a void-or-error result from a typed construct method.
void reportVoid(const std::string& label,
                const std::expected<void, std::string>& r) {
    if (r.has_value()) {
        std::cout << "  [typed]  " << label << " -> ok\n";
    } else {
        std::cout << "  [typed]  " << label << " FAILED: " << r.error() << "\n";
    }
}

// Builds a ParamMap from a small initializer list (keeps the intent calls terse).
ParamMap params(std::initializer_list<std::pair<std::string, AppleGraphics::ParamValue>> kvs) {
    ParamMap m;
    for (const auto& kv : kvs) {
        m.emplace(kv.first, kv.second);
    }
    return m;
}

} // namespace

int main() {
    std::cout << "--- Apple Unified Engine (cad-kernel) ---\n";

    // 1. Construct the engine with the default world bounds and the default
    //    headless NullRenderBackend (the engine creates one when given nullptr).
    AppleUnifiedEngine engine;
    std::cout << "Engine constructed (default world bounds, NullRenderBackend).\n";

    // 2. Instantiate all three reconfigurable constructs on the shared engine.
    //    Each ctor creates its root node under "root" and registers its Assistant
    //    Schemas on engine.intents().
    MenuDesigner menu(engine);
    FloorPlan floor(engine);
    StageSetup stage(engine);

    // 3. Each construct sets init_error_ iff its root addObject failed. On a fresh
    //    engine with distinct root ids ("menu"/"floor"/"stage") all should be empty.
    auto checkInit = [](const char* name, const auto& construct) {
        if (auto err = construct.initError(); err.has_value()) {
            std::cout << "  [init] " << name << " init error: " << *err << "\n";
        }
    };
    checkInit("MenuDesigner", menu);
    checkInit("FloorPlan", floor);
    checkInit("StageSetup", stage);
    std::cout << "Constructs instantiated (menu/floor/stage); init errors checked.\n";

    // 4. SIRI / APP INTENTS — drive the engine the way an assistant would, by
    //    dispatching declared Assistant Schemas through the shared intents bridge.
    std::cout << "\n[1] App Intents (Assistant Schemas) via engine.intents().dispatch:\n";

    // Floor: add a table by intent.
    reportDispatch("AddTable(t1)",
                   engine.intents().dispatch(
                       "AddTable", params({{"id", std::string("t1")},
                                           {"label", std::string("Window 1")},
                                           {"capacity", std::int64_t{4}},
                                           {"x", 10.0},
                                           {"y", 20.0},
                                           {"w", 30.0},
                                           {"h", 30.0}})));

    // Menu: needs a section first, then an item by intent.
    reportVoid("menu.addSection(mains)", menu.addSection("mains", "Mains"));
    reportDispatch("AddMenuItem(burger)",
                   engine.intents().dispatch(
                       "AddMenuItem", params({{"sectionId", std::string("mains")},
                                              {"id", std::string("burger")},
                                              {"name", std::string("Cheeseburger")},
                                              {"priceCents", std::int64_t{1450}}})));

    // Stage: add a channel by intent.
    reportDispatch("AddChannel(vox)",
                   engine.intents().dispatch(
                       "AddChannel", params({{"id", std::string("vox")},
                                             {"label", std::string("Lead Vocal")},
                                             {"x", 0.0},
                                             {"y", 0.0}})));

    // 4b. A couple of typed method calls directly (the same path the handlers use).
    std::cout << "\n[2] Typed construct methods (direct API):\n";
    reportVoid("floor.addTable(t2)",
               floor.addTable("t2", "Booth 2", 6, 100.0, 100.0, 40.0, 40.0));
    // Add a monitor (via the typed addElement under the Monitor kind), then assign
    // the vocal channel to that monitor mix.
    reportVoid("stage.addElement(Monitor wedge1)",
               stage.addElement(StageSetup::ElementKind::Monitor, "wedge1",
                                "Vocal Wedge", 0.0, 50.0));
    reportVoid("stage.assignToMix(vox -> wedge1)",
               stage.assignToMix("vox", "wedge1"));
    reportVoid("stage.setSplLimit(102 dB)", stage.setSplLimit(102.0));

    // 4c. Hit-test the spatial index: t2 sits at (100,100) with bounds 40x40, so a
    //     point inside it should resolve to "t2".
    {
        floorplan::geom::Vertex2D probe{120.0, 120.0};
        auto hit = engine.hitTest(probe);
        std::cout << "  [hit]    hitTest(120,120) -> "
                  << (hit.has_value() ? *hit : std::string("(none)")) << "\n";
    }

    // 5. SPATIAL COLLABORATION (simulated SharePlay) — add a remote Spatial Persona,
    //    arrange the roster with a template, move the persona, author a local op,
    //    and demonstrate idempotent replay of a remote op.
    std::cout << "\n[3] Spatial collaboration (SharePlay personas + op log):\n";
    if (auto added = engine.collab().addParticipant("Persona_Remote_01", true);
        !added.has_value()) {
        std::cout << "  [collab] addParticipant FAILED: " << added.error() << "\n";
    } else {
        std::cout << "  [collab] added Spatial Persona 'Persona_Remote_01'\n";
    }
    engine.collab().setSpatialTemplate(PersonaTemplate::Surround);
    std::cout << "  [collab] spatial template = Surround\n";
    if (auto posed = engine.collab().updateParticipantPose(
            "Persona_Remote_01", Vec3{1.0f, 0.0f, -2.0f});
        !posed.has_value()) {
        std::cout << "  [collab] updateParticipantPose FAILED: " << posed.error()
                  << "\n";
    } else {
        std::cout << "  [collab] updated persona pose\n";
    }

    // Author a local op (the constructs above already authored several via their
    // four-step mutation flow; this adds one more directly).
    CollabOp local =
        engine.collab().applyLocalOp("demo.note", "t1", R"({"note":"VIP"})");
    std::cout << "  [collab] applyLocalOp demo.note seq=" << local.seq << "\n";

    // Receive a remote op, then receive the SAME op again to show idempotency:
    // the second receive is a no-op (returns false) and does not grow the log.
    CollabOp remote{"Persona_Remote_01", 1, "remote.move", "t2", R"({"dx":5})"};
    bool first = engine.collab().receiveRemoteOp(remote);
    bool dup = engine.collab().receiveRemoteOp(remote);
    std::cout << "  [collab] receiveRemoteOp first=" << std::boolalpha << first
              << " duplicate=" << dup << " (idempotent)\n";
    std::cout << "  [collab] total ops in log = " << engine.collab().opCount() << "\n";

    // 6. AUDIO — every construct mutation triggered a procedural SoundEvent, so the
    //    synth's total trigger count reflects the interactions above. Then report a
    //    simulated audio-session route change.
    std::cout << "\n[4] Audio (procedural synth + session routing):\n";
    std::cout << "  [audio]  synth total triggers so far = "
              << engine.synth().totalTriggers() << "\n";
    engine.audioSession().handleRouteChange("BuiltInSpeaker");
    std::cout << "  [audio]  route changed -> "
              << engine.audioSession().currentRoute() << " (changes="
              << engine.audioSession().routeChangeCount() << ")\n";

    // 7. RENDER — drive a couple of frames through the render backend.
    std::cout << "\n[5] Render (frame drive through RenderBackend):\n";
    engine.update();
    engine.update();
    std::cout << "  [render] frameCount = " << engine.renderer().frameCount() << "\n";

    // 8. Final summary.
    std::cout << "\n--- Summary ---\n";
    std::cout << "  tables=" << floor.tableCount()
              << " sections=" << menu.sectionCount()
              << " items=" << menu.itemCount()
              << " stageElements=" << stage.elementCount()
              << " collabParticipants=" << engine.collab().participants().size()
              << " ops=" << engine.collab().opCount()
              << " synthTriggers=" << engine.synth().totalTriggers()
              << " frames=" << engine.renderer().frameCount() << "\n";
    std::cout << "Apple Unified Engine demo completed successfully.\n";
    return 0;
}
