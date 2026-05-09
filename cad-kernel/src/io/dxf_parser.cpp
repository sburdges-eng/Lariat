#include "io/dxf_parser.hpp"

namespace floorplan::io {

[[nodiscard]] std::expected<std::vector<DXFNode>, std::string> DXFParser::parse(const std::string& dxf_content) {
    if (dxf_content.empty()) return std::unexpected("DXF content is empty.");
    
    // Stub: Simulated AST generation
    std::vector<DXFNode> ast;
    ast.push_back({0, "SECTION"});
    ast.push_back({2, "ENTITIES"});
    ast.push_back({0, "ENDSEC"});
    ast.push_back({0, "EOF"});
    
    return ast;
}

} // namespace floorplan::io
