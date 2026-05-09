#include <expected>
#include <string>
#include <iostream>
int main() {
    std::expected<int, std::string> e = std::unexpected("error");
    std::cout << e.error() << std::endl;
}
