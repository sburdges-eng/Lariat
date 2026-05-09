
#include "solver/jacobian.hpp"

namespace floorplan::solver {

void Jacobian::updateGradients(const std::vector<double>& /*current_state*/) {}

[[nodiscard]] std::vector<std::vector<double>> Jacobian::getMatrix() const {
    return std::vector<std::vector<double>>(num_constraints_, std::vector<double>(num_variables_, 1.0)); // STUB
}

} // namespace floorplan::solver
