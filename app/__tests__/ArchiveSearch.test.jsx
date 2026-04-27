/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ArchiveSearch from '../shows/archive/ArchiveSearch';

const ROWS = [
  { id: 1, band_name: 'open mic', show_date: '2025-02-26', era_year: 2025 },
  { id: 2, band_name: 'the hip snacks', show_date: '2024-03-01', era_year: 2024 },
];

describe('ArchiveSearch', () => {
  test('renders one row per archive entry', () => {
    render(<ArchiveSearch initialRows={ROWS} eras={[2025, 2024]} />);
    expect(screen.getByText('open mic')).toBeInTheDocument();
    expect(screen.getByText('the hip snacks')).toBeInTheDocument();
  });

  test('filters by band substring (client-side)', () => {
    render(<ArchiveSearch initialRows={ROWS} eras={[2025, 2024]} />);
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'snacks' } });
    expect(screen.getByText('the hip snacks')).toBeInTheDocument();
    expect(screen.queryByText('open mic')).toBeNull();
  });

  test('filters by era', () => {
    render(<ArchiveSearch initialRows={ROWS} eras={[2025, 2024]} />);
    fireEvent.change(screen.getByLabelText(/era/i), { target: { value: '2024' } });
    expect(screen.queryByText('open mic')).toBeNull();
    expect(screen.getByText('the hip snacks')).toBeInTheDocument();
  });

  test('shows empty state when no matches', () => {
    render(<ArchiveSearch initialRows={ROWS} eras={[2025, 2024]} />);
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'xyz' } });
    expect(screen.getByText(/no matches/i)).toBeInTheDocument();
  });
});
