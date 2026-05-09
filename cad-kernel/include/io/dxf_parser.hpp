#pragma once
#include <expected>
#include <string>
#include <vector>

namespace floorplan::io {

/**
 * @brief Abstract Syntax Tree (AST) Node for DXF Group Codes.
 */
struct DXFNode {
    int group_code;
    std::string value;
};

/**
 * @brief Lexical Analyzer and AST Generator for DXF Import/Export.
 */
class DXFParser {
public:
    [[nodiscard]] static std::expected<std::vector<DXFNode>, std::string> parse(const std::string& dxf_content);
};

} // namespace floorplan::io
