
#pragma once
#include <vector>

namespace floorplan::solver {

class Jacobian {
public:
    struct GradientSoA {
        std::vector<double> df_dx;
        std::vector<double> df_dy;
        std::vector<double> df_dtheta;
    };

    constexpr Jacobian(size_t num_constraints, size_t num_variables) 
        : num_constraints_(num_constraints), num_variables_(num_variables) {
        gradients_.df_dx.resize(num_constraints * num_variables, 0.0);
        gradients_.df_dy.resize(num_constraints * num_variables, 0.0);
        gradients_.df_dtheta.resize(num_constraints * num_variables, 0.0);
    }

    void updateGradients(const std::vector<double>& current_state);
    [[nodiscard]] std::vector<std::vector<double>> getMatrix() const;

private:
    size_t num_constraints_;
    size_t num_variables_;
    GradientSoA gradients_;
};

} // namespace floorplan::solver
