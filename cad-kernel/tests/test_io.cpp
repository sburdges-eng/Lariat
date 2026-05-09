#include <gtest/gtest.h>
#include "io/dxf_parser.hpp"

using namespace floorplan::io;

TEST(DXFParserTest, ParseEmptyString) {
    auto res = DXFParser::parse("");
    ASSERT_FALSE(res.has_value());
    EXPECT_EQ(res.error(), "DXF content is empty.");
}

TEST(DXFParserTest, ParseValidStub) {
    auto res = DXFParser::parse("0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF");
    ASSERT_TRUE(res.has_value());
    EXPECT_EQ(res.value().size(), 4);
    EXPECT_EQ(res.value()[0].group_code, 0);
    EXPECT_EQ(res.value()[0].value, "SECTION");
}
