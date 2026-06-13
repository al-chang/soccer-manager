// Name pools for the two fictional (but realistic-flavored) nations.

export interface NationNamePool {
  first: string[];
  last: string[];
  managerFirst: string[];
}

// Nation 0: "Albion" — English-flavored
const albionFirst = [
  'Jack', 'Harry', 'Oliver', 'George', 'Charlie', 'Thomas', 'Jacob', 'Alfie', 'Freddie', 'Oscar',
  'James', 'William', 'Henry', 'Leo', 'Archie', 'Joshua', 'Ethan', 'Daniel', 'Samuel', 'Max',
  'Callum', 'Connor', 'Lewis', 'Kyle', 'Ryan', 'Liam', 'Nathan', 'Aaron', 'Luke', 'Ben',
  'Mason', 'Logan', 'Dylan', 'Jamie', 'Owen', 'Rhys', 'Cole', 'Finley', 'Reece', 'Declan',
  'Marcus', 'Trent', 'Jude', 'Phil', 'Kieran', 'Ashley', 'Dominic', 'Joe', 'Conor', 'Bukayo',
];
const albionLast = [
  'Smith', 'Jones', 'Taylor', 'Brown', 'Williams', 'Wilson', 'Johnson', 'Davies', 'Robinson', 'Wright',
  'Thompson', 'Evans', 'Walker', 'White', 'Roberts', 'Green', 'Hall', 'Wood', 'Jackson', 'Clarke',
  'Hughes', 'Edwards', 'Turner', 'Hill', 'Ward', 'Cooper', 'Morris', 'Moore', 'Clark', 'King',
  'Baker', 'Harrison', 'Morgan', 'Allen', 'James', 'Scott', 'Phillips', 'Watson', 'Davis', 'Parker',
  'Bennett', 'Price', 'Griffiths', 'Young', 'Mitchell', 'Barnes', 'Shaw', 'Henderson', 'Marsh', 'Gallagher',
  'Sterling', 'Foden', 'Maddison', 'Bowen', 'Palmer', 'Saka', 'Rice', 'Stones', 'Pickford', 'Ramsdale',
];

// Nation 1: "Hispania" — Spanish-flavored
const hispaniaFirst = [
  'Alejandro', 'Pablo', 'Daniel', 'David', 'Adrián', 'Javier', 'Álvaro', 'Diego', 'Mario', 'Sergio',
  'Carlos', 'Marcos', 'Iván', 'Rubén', 'Miguel', 'Antonio', 'Manuel', 'Jorge', 'Raúl', 'Víctor',
  'Iker', 'Unai', 'Ander', 'Mikel', 'Asier', 'Gorka', 'Aitor', 'Xabi', 'Pedri', 'Gavi',
  'Fernando', 'Luis', 'José', 'Juan', 'Francisco', 'Ángel', 'Rodrigo', 'Hugo', 'Bruno', 'Nico',
  'Santi', 'Dani', 'Isco', 'Koke', 'Saúl', 'Marco', 'Pau', 'Eric', 'César', 'Rafael',
];
const hispaniaLast = [
  'García', 'Fernández', 'González', 'Rodríguez', 'López', 'Martínez', 'Sánchez', 'Pérez', 'Gómez', 'Martín',
  'Jiménez', 'Ruiz', 'Hernández', 'Díaz', 'Moreno', 'Álvarez', 'Romero', 'Alonso', 'Gutiérrez', 'Navarro',
  'Torres', 'Domínguez', 'Vázquez', 'Ramos', 'Gil', 'Ramírez', 'Serrano', 'Blanco', 'Molina', 'Morales',
  'Ortega', 'Delgado', 'Castro', 'Ortiz', 'Rubio', 'Marín', 'Sanz', 'Iglesias', 'Medina', 'Garrido',
  'Cortés', 'Castillo', 'Santos', 'Lozano', 'Guerrero', 'Cano', 'Prieto', 'Méndez', 'Cruz', 'Herrera',
  'Etxeberria', 'Zubizarreta', 'Aguirre', 'Urrutia', 'Goikoetxea', 'Olmo', 'Merino', 'Zubimendi', 'Oyarzabal', 'Williams',
];

export const NAME_POOLS: NationNamePool[] = [
  { first: albionFirst, last: albionLast, managerFirst: albionFirst },
  { first: hispaniaFirst, last: hispaniaLast, managerFirst: hispaniaFirst },
];

// ---- Club name generation ----

export const ALBION_CITIES = [
  'Ashford', 'Blackmoor', 'Carlton', 'Dunhill', 'Eastleigh', 'Fairview', 'Grimsworth', 'Hartfield',
  'Ironbridge', 'Kingsford', 'Langdale', 'Millbrook', 'Northgate', 'Oakhampton', 'Pemberley', 'Queensbury',
  'Ravenshollow', 'Stonebridge', 'Thornton', 'Underwood', 'Veldham', 'Westmere', 'Yorkfield', 'Bridgewater',
  'Claymore', 'Foxborough', 'Heathcote', 'Marsden', 'Redcliffe', 'Silverton', 'Wexley', 'Ambleside',
];
export const ALBION_SUFFIXES = [
  'United', 'City', 'Rovers', 'Athletic', 'Town', 'Wanderers', 'Albion', 'County', 'FC', 'Rangers',
];

export const HISPANIA_CITIES = [
  'Valdoria', 'San Marcos', 'Puerto Blanco', 'Montevera', 'Alcaraz', 'Riodelmar', 'Castellón Viejo',
  'Las Colinas', 'Torrealta', 'Vega del Sol', 'Aldebarán', 'Sierra Roja', 'Bahía Verde', 'Costa Dorada',
  'Miravalle', 'El Faro', 'Santa Lucía', 'Peñascal', 'Fuentebrava', 'Lago Azul', 'Cerro Alto',
  'Villanueva', 'Puente Real', 'Arroyo Seco', 'Dos Hermanos', 'La Floresta', 'Marbeya', 'Solandia',
  'Trespuentes', 'Valle Hondo', 'Zarzuela', 'Cabo Norte',
];
export const HISPANIA_PREFIXES = [
  'Real', 'Atlético', 'Deportivo', 'Racing', 'Sporting', 'CD', 'CF', 'UD', 'Real Sociedad de', 'Club',
];

export const CLUB_COLORS: [string, string][] = [
  ['#d32f2f', '#ffffff'], ['#1565c0', '#ffffff'], ['#2e7d32', '#ffffff'], ['#f9a825', '#1a1a2e'],
  ['#6a1b9a', '#ffffff'], ['#00838f', '#ffffff'], ['#c62828', '#fdd835'], ['#283593', '#ff8f00'],
  ['#37474f', '#eceff1'], ['#4e342e', '#ffcc80'], ['#ad1457', '#ffffff'], ['#00695c', '#b2dfdb'],
  ['#e64a19', '#ffffff'], ['#5e35b1', '#ffd54f'], ['#0277bd', '#b3e5fc'], ['#558b2f', '#f1f8e9'],
  ['#b71c1c', '#000000'], ['#1a237e', '#ffffff'], ['#004d40', '#ffab40'], ['#880e4f', '#f8bbd0'],
  ['#01579b', '#ffeb3b'], ['#33691e', '#ffffff'], ['#bf360c', '#212121'], ['#311b92', '#80deea'],
  ['#9e9d24', '#1a1a2e'], ['#00acc1', '#1a1a2e'], ['#8e24aa', '#c8e6c9'], ['#3e2723', '#ffd180'],
  ['#dd2c00', '#eceff1'], ['#1b5e20', '#ffe082'], ['#4527a0', '#ff7043'], ['#006064', '#fff176'],
];

export const INJURY_NAMES = [
  'Hamstring strain', 'Sprained ankle', 'Groin strain', 'Calf strain', 'Knee ligament damage',
  'Bruised ribs', 'Thigh strain', 'Twisted knee', 'Back spasm', 'Dead leg', 'Hip problem',
  'Achilles tendon irritation', 'Shoulder injury', 'Fractured wrist', 'Concussion',
];
